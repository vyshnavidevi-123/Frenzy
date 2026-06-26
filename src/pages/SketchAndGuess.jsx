// SketchAndGuess.jsx
// Main game controller: turn rotation, word picking, 60s timer, scoring, round flow.

import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import DrawingCanvas from "../components/DrawingCanvas";
import GuessChat from "../components/GuessChat";
import { getRandomWords } from "../WordBank";
import { getPlayerSession } from "../playerIdentity";

const ROUND_SECONDS = 60;
const WORD_PICK_SECONDS = 10;
const TOTAL_ROUNDS_PER_PLAYER = 1; // each player draws once per game
const MIN_PLAYERS = 2;

export default function SketchAndGuess() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [wordChoices, setWordChoices] = useState([]);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [pickTimeLeft, setPickTimeLeft] = useState(WORD_PICK_SECONDS);

  const { nickname, isHost } = getPlayerSession();
  const timerRef = useRef(null);
  const pickTimerRef = useRef(null);
  const initInFlight = useRef(false);

  // ── Subscribe to room ───────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) { navigate("/"); return; }
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.data();
      setRoom(data);
      setLoading(false);

      // Initialize game state if not present (host responsibility)
      if (isHost && !data.sketchGame && !initInFlight.current) {
        const playerList = data.players || [];
        if (playerList.length >= MIN_PLAYERS) {
          initInFlight.current = true;
          initGame(playerList).finally(() => {
            initInFlight.current = false;
          });
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function initGame(playerList) {
    const order = playerList.map((p) => p.nickname).sort(() => Math.random() - 0.5);
    await updateDoc(doc(db, "rooms", roomId), {
      sketchGame: {
        order,
        currentDrawerIndex: 0,
        round: 1,
        phase: "picking", // picking | drawing | results | finished
        currentWord: null,
        roundEndsAt: null,
        pickEndsAt: Date.now() + WORD_PICK_SECONDS * 1000,
        scores: Object.fromEntries(order.map((n) => [n, 0])),
      },
      canvasStrokes: [],
      chatMessages: [],
    });
  }

  const game = room?.sketchGame;
  const players = room?.players || [];
  const currentDrawer = game?.order?.[game.currentDrawerIndex];
  const isDrawer = currentDrawer === nickname;

  // ── Word picking phase: drawer sees 3 choices ────────────────────────────
  useEffect(() => {
    if (!game || game.phase !== "picking") return;
    if (isDrawer && wordChoices.length === 0) {
      setWordChoices(getRandomWords(room?.wordPack || "general", 3));
    }
    if (!isDrawer) {
      setWordChoices([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, isDrawer, room?.wordPack, game?.currentDrawerIndex]);

  // Picking countdown — drawer auto-picks if time runs out
  useEffect(() => {
    if (!game || game.phase !== "picking" || !isDrawer) return;
    setPickTimeLeft(WORD_PICK_SECONDS);
    pickTimerRef.current = setInterval(() => {
      setPickTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(pickTimerRef.current);
          const fallbackWord = wordChoices.length
            ? wordChoices[0]
            : getRandomWords(room?.wordPack || "general", 1)[0];
          chooseWord(fallbackWord);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(pickTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, isDrawer, wordChoices]);

  // HOST SAFETY NET: force-pick a word if the picking phase stalls
  useEffect(() => {
    if (!isHost || !game || game.phase !== "picking" || !game.pickEndsAt) return;
    const msLeft = game.pickEndsAt - Date.now() + 2000; // 2s grace period
    if (msLeft <= 0) {
      forcePickWord();
      return;
    }
    const t = setTimeout(forcePickWord, msLeft);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, game?.phase, game?.pickEndsAt]);

  async function forcePickWord() {
    const roomRef = doc(db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    const g = snap.data()?.sketchGame;
    if (!g || g.phase !== "picking") return;
    const word = getRandomWords(room?.wordPack || "general", 1)[0];
    const endsAt = Date.now() + ROUND_SECONDS * 1000;
    await updateDoc(roomRef, {
      "sketchGame.phase": "drawing",
      "sketchGame.currentWord": word,
      "sketchGame.roundEndsAt": endsAt,
      canvasStrokes: [],
      chatMessages: [],
    });
  }

  async function goToGames() {
    await updateDoc(doc(db, "rooms", roomId), {
      gameStatus: "selecting",
    });

    navigate(`/game-select/${roomId}`);
  }


  async function chooseWord(word) {
    clearInterval(pickTimerRef.current);
    const endsAt = Date.now() + ROUND_SECONDS * 1000;
    const roomRef = doc(db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    const g = snap.data()?.sketchGame;
    if (!g || g.phase !== "picking") return;
    await updateDoc(roomRef, {
      "sketchGame.phase": "drawing",
      "sketchGame.currentWord": word,
      "sketchGame.roundEndsAt": endsAt,
      canvasStrokes: [],
      chatMessages: [],
    });
    setWordChoices([]);
  }

  // ── Drawing phase: countdown timer (host drives end) ─────────────────────
  useEffect(() => {
    if (!game || game.phase !== "drawing" || !game.roundEndsAt) return;

    function tick() {
      const remaining = Math.max(0, Math.round((game.roundEndsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0 && isHost) {
        endRound(null);
      }
    }
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, game?.roundEndsAt, isHost]);

  // ── End round (correct guess OR timeout) ─────────────────────────────────
  const endRound = useCallback(async (winnerNickname) => {
    clearInterval(timerRef.current);
    const roomRef = doc(db, "rooms", roomId);
    const snap = await getDoc(roomRef);
    const g = snap.data()?.sketchGame;
    if (!g || g.phase !== "drawing") return;

    const newScores = { ...g.scores };
    if (winnerNickname) {
      newScores[winnerNickname] = (newScores[winnerNickname] || 0) + 100;
      const drawer = g.order[g.currentDrawerIndex];
      newScores[drawer] = (newScores[drawer] || 0) + 25; // drawer bonus
    }

    await updateDoc(roomRef, {
      "sketchGame.phase": "results",
      "sketchGame.scores": newScores,
      "sketchGame.lastWinner": winnerNickname,
    });
  }, [roomId]);

  function handleCorrectGuess(guesserName) {
    endRound(guesserName);
  }

  // ── Advance to next round / drawer ────────────────────────────────────────
  async function nextRound() {
    if (!isHost) return;
    const nextIndex = game.currentDrawerIndex + 1;
    const gameOver = nextIndex >= game.order.length * TOTAL_ROUNDS_PER_PLAYER;

    if (gameOver) {
      await updateDoc(doc(db, "rooms", roomId), {
        "sketchGame.phase": "finished",
      });
      return;
    }

    await updateDoc(doc(db, "rooms", roomId), {
      "sketchGame.currentDrawerIndex": nextIndex,
      "sketchGame.round": game.round + 1,
      "sketchGame.phase": "picking",
      "sketchGame.currentWord": null,
      "sketchGame.roundEndsAt": null,
      "sketchGame.pickEndsAt": Date.now() + WORD_PICK_SECONDS * 1000,
      "sketchGame.lastWinner": null,
      canvasStrokes: [],
      chatMessages: [],
    });
  }

  async function backToLobby() {
    await updateDoc(doc(db, "rooms", roomId), {
      status: "waiting",
      selectedGame: null,
      sketchGame: null,
    });
    navigate(`/lobby/${roomId}`);
  }

  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={{ color: "rgba(255,255,255,0.5)", marginTop: "16px" }}>Loading game…</p>
      </div>
    );
  }

  if (!game) {
    return (
      <div style={s.center}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎨</div>
        <p style={{ color: "#fff", fontSize: "18px", fontWeight: 700, marginBottom: "8px", textAlign: "center", padding: "0 20px" }}>
          Need at least {MIN_PLAYERS} players to start
        </p>
        <p style={{ color: "rgba(255,255,255,0.5)" }}>
          {players.length}/{MIN_PLAYERS} players in room…
        </p>
      </div>
    );
  }

  const sortedScores = Object.entries(game.scores || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div style={s.page}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes popIn { from{opacity:0; transform:scale(0.9)} to{opacity:1; transform:scale(1)} }

        .sg-game-grid {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 16px;
        }
        .sg-chat-col { min-height: 300px; }
        .sg-top-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 20px;
        }
        .sg-word-btn {
          padding: 18px 28px;
          font-size: 18px;
        }
        .sg-pick-title { font-size: 26px; }
        .sg-big-emoji { font-size: 56px; }
        .sg-container { max-width: 920px; margin: 0 auto; }
        .sg-page { padding: 20px 16px 40px; }

        @media (max-width: 720px) {
          .sg-game-grid {
            grid-template-columns: 1fr;
          }
          .sg-chat-col { min-height: 240px; }
        }

        @media (max-width: 480px) {
          .sg-page { padding: 14px 10px 28px; }
          .sg-top-bar { gap: 8px; margin-bottom: 14px; }
          .sg-top-bar > * { font-size: 12px !important; padding: 6px 12px !important; }
          .sg-word-btn { padding: 14px 18px !important; font-size: 16px !important; }
          .sg-pick-title { font-size: 21px !important; }
          .sg-big-emoji { font-size: 40px !important; margin-bottom: 10px !important; }
          .sg-word-mask { font-size: 18px !important; letter-spacing: 4px !important; }
          .sg-score-row { padding: 10px 12px !important; }
          .sg-next-btn { width: 100%; padding: 14px 0 !important; font-size: 15px !important; }
        }
      `}</style>

      <div className="sg-page" style={s.page}>
        <div className="sg-container" style={s.container}>

          {/* Top bar */}
          <div className="sg-top-bar" style={s.topBar}>
            <button style={s.backBtn} onClick={goToGames}>
              ← Games
            </button>
            <div style={s.roundBadge}>
              🎨 Round {game.round} / {game.order.length}
            </div>
            {game.phase === "drawing" && (
              <div style={{
                ...s.timer,
                color: timeLeft <= 10 ? "#f87171" : "#fff",
              }}>
                ⏱ {timeLeft}s
              </div>
            )}
            <div style={s.drawerBadge}>
              ✏️ {currentDrawer} is drawing
            </div>
          </div>

          {/* ── PICKING PHASE ── */}
          {game.phase === "picking" && (
            <div style={s.pickWrap}>
              {isDrawer ? (
                <>
                  <h2 className="sg-pick-title" style={s.pickTitle}>Pick a word to draw</h2>
                  <p style={s.pickSub}>Auto-picking in {pickTimeLeft}s…</p>
                  {wordChoices.length > 0 ? (
                    <div style={s.wordChoices}>
                      {wordChoices.map((w) => (
                        <button key={w} className="sg-word-btn" style={s.wordBtn} onClick={() => chooseWord(w)}>
                          {w}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p style={s.pickSub}>Loading word choices…</p>
                  )}
                </>
              ) : (
                <div style={s.waitingPick}>
                  <div className="sg-big-emoji" style={s.bigEmoji}>✏️</div>
                  <h2 className="sg-pick-title" style={s.pickTitle}>{currentDrawer} is picking a word…</h2>
                  <p style={s.pickSub}>Get ready to guess!</p>
                </div>
              )}
            </div>
          )}

          {/* ── DRAWING PHASE ── */}
          {game.phase === "drawing" && (
            <div className="sg-game-grid">
              <div style={s.canvasCol}>
                <DrawingCanvas
                  roomId={roomId}
                  isDrawer={isDrawer}
                  currentWord={game.currentWord}
                />
                {!isDrawer && (
                  <div className="sg-word-mask" style={s.wordMask}>
                    Word: {game.currentWord.split("").map((c) =>
                      c === " " ? "  " : "_ "
                    )}
                    <span style={s.wordLenHint}>({game.currentWord.length} letters)</span>
                  </div>
                )}
              </div>
              <div className="sg-chat-col" style={s.chatCol}>
                <GuessChat
                  roomId={roomId}
                  isDrawer={isDrawer}
                  currentWord={game.currentWord}
                  nickname={nickname}
                  onCorrectGuess={handleCorrectGuess}
                />
              </div>
            </div>
          )}

          {/* ── RESULTS PHASE ── */}
          {game.phase === "results" && (
            <div style={s.resultsWrap}>
              <div className="sg-big-emoji" style={s.bigEmoji}>{game.lastWinner ? "🎉" : "⏰"}</div>
              <h2 className="sg-pick-title" style={s.pickTitle}>
                {game.lastWinner
                  ? `${game.lastWinner} guessed it!`
                  : "Time's up!"}
              </h2>
              <p style={s.pickSub}>
                The word was <strong style={{ color: "#a855f7" }}>{game.currentWord}</strong>
              </p>

              <div style={s.scoreboard}>
                {sortedScores.map(([name, score], i) => (
                  <div key={name} className="sg-score-row" style={s.scoreRow}>
                    <span style={s.scoreRank}>#{i + 1}</span>
                    <span style={s.scoreName}>{name}</span>
                    <span style={s.scorePoints}>{score} pts</span>
                  </div>
                ))}
              </div>

              {isHost && (
                <button className="sg-next-btn" style={s.nextBtn} onClick={nextRound}>
                  {game.currentDrawerIndex + 1 >= game.order.length
                    ? "🏆 See Final Results"
                    : "Next Round →"}
                </button>
              )}
              {!isHost && (
                <p style={s.waitHostNote}>Waiting for host to continue…</p>
              )}
            </div>
          )}

          {/* ── FINISHED PHASE ── */}
          {game.phase === "finished" && (
            <div style={s.resultsWrap}>
              <div className="sg-big-emoji" style={s.bigEmoji}>🏆</div>
              <h2 className="sg-pick-title" style={s.pickTitle}>Game Over!</h2>
              <p style={s.pickSub}>
                <strong style={{ color: "#facc15" }}>{sortedScores[0]?.[0]}</strong> wins with {sortedScores[0]?.[1]} points!
              </p>

              <div style={s.scoreboard}>
                {sortedScores.map(([name, score], i) => (
                  <div key={name} className="sg-score-row" style={{
                    ...s.scoreRow,
                    ...(i === 0 ? s.scoreRowWinner : {}),
                  }}>
                    <span style={s.scoreRank}>{i === 0 ? "👑" : `#${i + 1}`}</span>
                    <span style={s.scoreName}>{name}</span>
                    <span style={s.scorePoints}>{score} pts</span>
                  </div>
                ))}
              </div>

              {isHost ? (
                <button className="sg-next-btn" style={s.nextBtn} onClick={backToLobby}>
                  Back to Lobby
                </button>
              ) : (
                <p style={s.waitHostNote}>Waiting for host…</p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const s = {
  backBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "999px",
    padding: "8px 16px",
    color: "rgba(255,255,255,0.65)",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
  },
  page: {
    minHeight: "100vh",
    background: "linear-gradient(160deg, #0d0d1a 0%, #1a0f2e 50%, #0d1a2e 100%)",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  container: {},
  center: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(160deg, #0d0d1a 0%, #1a0f2e 50%, #0d1a2e 100%)",
    padding: "0 16px",
    textAlign: "center",
  },
  spinner: {
    width: "40px", height: "40px",
    border: "3px solid rgba(255,255,255,0.1)",
    borderTop: "3px solid #a855f7",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  topBar: {},
  roundBadge: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "999px",
    padding: "8px 16px",
    color: "rgba(255,255,255,0.7)",
    fontSize: "13px",
    fontWeight: "700",
    whiteSpace: "nowrap",
  },
  timer: {
    fontSize: "20px",
    fontWeight: "800",
    background: "rgba(255,255,255,0.06)",
    padding: "6px 18px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,0.1)",
    whiteSpace: "nowrap",
  },
  drawerBadge: {
    background: "rgba(168,85,247,0.15)",
    border: "1px solid rgba(168,85,247,0.3)",
    color: "#c084fc",
    borderRadius: "999px",
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: "700",
    whiteSpace: "nowrap",
  },
  canvasCol: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 },
  chatCol: {},
  wordMask: {
    textAlign: "center",
    color: "#fff",
    fontSize: "24px",
    letterSpacing: "6px",
    fontWeight: "700",
    fontFamily: "monospace",
    wordBreak: "break-word",
  },
  wordLenHint: {
    display: "block",
    fontSize: "12px",
    color: "rgba(255,255,255,0.3)",
    letterSpacing: "normal",
    fontFamily: "'Segoe UI', sans-serif",
    marginTop: "4px",
  },
  pickWrap: {
    textAlign: "center",
    padding: "60px 20px",
    animation: "popIn 0.3s ease",
  },
  waitingPick: { display: "flex", flexDirection: "column", alignItems: "center" },
  bigEmoji: { fontSize: "56px", marginBottom: "16px" },
  pickTitle: { color: "#fff", fontSize: "26px", fontWeight: "800", margin: "0 0 8px" },
  pickSub: { color: "rgba(255,255,255,0.45)", fontSize: "14px", margin: "0 0 24px" },
  wordChoices: { display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" },
  wordBtn: {
    padding: "18px 28px",
    borderRadius: "16px",
    border: "1px solid rgba(168,85,247,0.3)",
    background: "rgba(168,85,247,0.1)",
    color: "#fff",
    fontSize: "18px",
    fontWeight: "700",
    cursor: "pointer",
    textTransform: "capitalize",
    transition: "transform 0.15s, background 0.15s",
  },
  resultsWrap: {
    textAlign: "center",
    padding: "40px 20px",
    animation: "popIn 0.3s ease",
  },
  scoreboard: {
    maxWidth: "400px",
    margin: "0 auto 28px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  scoreRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "12px",
    padding: "12px 16px",
  },
  scoreRowWinner: {
    border: "1px solid rgba(250,204,21,0.4)",
    background: "rgba(250,204,21,0.08)",
  },
  scoreRank: { color: "rgba(255,255,255,0.4)", fontWeight: "700", width: "30px" },
  scoreName: { color: "#fff", fontWeight: "600", flex: 1, textAlign: "left" },
  scorePoints: { color: "#a78bfa", fontWeight: "800" },
  nextBtn: {
    padding: "16px 36px",
    borderRadius: "14px",
    border: "none",
    background: "linear-gradient(135deg, #a855f7, #6366f1)",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(168,85,247,0.4)",
  },
  waitHostNote: { color: "rgba(255,255,255,0.3)", fontSize: "13px" },
};
