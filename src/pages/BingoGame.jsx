import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, updateDoc, arrayUnion, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getPlayerSession } from "../playerIdentity";

function generateCard() {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  const grid = [];
  for (let i = 0; i < 5; i++) {
    grid.push(numbers.slice(i * 5, i * 5 + 5));
  }
  return grid;
}

function countLines(grid, calledSet) {
  let lines = 0;
  for (let r = 0; r < 5; r++) {
    if (grid[r].every((n) => calledSet.has(n))) lines++;
  }
  for (let c = 0; c < 5; c++) {
    if (grid.every((row) => calledSet.has(row[c]))) lines++;
  }
  if (grid.every((row, i) => calledSet.has(row[i]))) lines++;
  if (grid.every((row, i) => calledSet.has(row[4 - i]))) lines++;
  return lines;
}

function getLineStatuses(grid, calledSet) {
  const rows = grid.map((row) => row.every((n) => calledSet.has(n)));
  const cols = [0, 1, 2, 3, 4].map((c) => grid.every((row) => calledSet.has(row[c])));
  const diag1 = grid.every((row, i) => calledSet.has(row[i]));
  const diag2 = grid.every((row, i) => calledSet.has(row[4 - i]));
  return { rows, cols, diag1, diag2 };
}

function isCellWinning(ri, ci, lineStatus) {
  return (
    lineStatus.rows[ri] ||
    lineStatus.cols[ci] ||
    (ri === ci && lineStatus.diag1) ||
    (ri + ci === 4 && lineStatus.diag2)
  );
}

const BINGO_LETTERS = ["B", "I", "N", "G", "O"];
const LETTER_COLORS = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa"];

export default function BingoGame() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { playerId, isHost, nickname } = getPlayerSession();

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [roomData, setRoomData] = useState(null);
  const [myCard, setMyCard] = useState(null);
  const [winner, setWinner] = useState(null);
  const [justCalled, setJustCalled] = useState(null);
  const [claimingBingo, setClaimingBingo] = useState(false);
  const [inputNum, setInputNum] = useState("");
  const [inputError, setInputError] = useState("");
  const [callCooldown, setCallCooldown] = useState(false);

  const inputRef = useRef(null);

  // Reactive mobile detection
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Listen to room
  useEffect(() => {
    if (!roomId) { navigate("/"); return; }
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) { navigate("/"); return; }
      const data = snap.data();
      setRoomData(data);

      const bingo = data.bingo || {};
      if (bingo.winner) {
        setWinner(bingo.winner);
      } else {
        setWinner(null);
      }

      const called = bingo.calledNumbers || [];
      if (called.length > 0) {
        const last = called[called.length - 1];
        setJustCalled(last);
        setTimeout(() => setJustCalled(null), 2000);
      }
    });
    return () => unsub();
  }, [roomId, navigate]);

  // Init / load card
  useEffect(() => {
    if (!roomId || !playerId) return;
    async function initCard() {
      const snap = await getDoc(doc(db, "rooms", roomId));
      if (!snap.exists()) return;
      const data = snap.data();
      const cards = data.bingo?.cards || {};

      if (cards[playerId]) {
        setMyCard(cards[playerId]);
      } else {
        const newCard = generateCard();
        setMyCard(newCard);
        await updateDoc(doc(db, "rooms", roomId), {
          [`bingo.cards.${playerId}`]: newCard,
        });
      }

      if (!data.bingo?.calledNumbers) {
        await updateDoc(doc(db, "rooms", roomId), {
          "bingo.calledNumbers": [],
          "bingo.winner": null,
          "bingo.gameOver": false,
          "bingo.lastCaller": null,
        });
      }
    }
    initCard();
  }, [roomId, playerId]);

  async function callNumber() {
    const num = parseInt(inputNum, 10);
    if (isNaN(num) || num < 1 || num > 25) {
      setInputError("Enter a number between 1 and 25.");
      return;
    }
    const calledNumbers = roomData?.bingo?.calledNumbers || [];
    if (calledNumbers.includes(num)) {
      setInputError(`${num} was already called!`);
      return;
    }
    setInputError("");
    setCallCooldown(true);
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        "bingo.calledNumbers": arrayUnion(num),
        "bingo.lastCaller": { playerId, nickname },
      });
      setInputNum("");
      inputRef.current?.focus();
    } catch {
      setInputError("Failed to call number. Try again.");
    } finally {
      setTimeout(() => setCallCooldown(false), 800);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") callNumber();
  }

  async function claimBingo() {
    if (claimingBingo || winner || !myCard) return;
    const calledNumbers = roomData?.bingo?.calledNumbers || [];
    const calledSet = new Set(calledNumbers);
    const lines = countLines(myCard, calledSet);
    if (lines < 5) return;
    setClaimingBingo(true);
    try {
      await updateDoc(doc(db, "rooms", roomId), {
        "bingo.winner": { playerId, nickname },
        "bingo.gameOver": true,
      });
    } finally {
      setClaimingBingo(false);
    }
  }

  async function restartGame() {
    await updateDoc(doc(db, "rooms", roomId), {
      "bingo.calledNumbers": [],
      "bingo.winner": null,
      "bingo.gameOver": false,
      "bingo.cards": {},
      "bingo.lastCaller": null,
    });
    setMyCard(null);
    setWinner(null);
    const newCard = generateCard();
    setMyCard(newCard);
    await updateDoc(doc(db, "rooms", roomId), {
      [`bingo.cards.${playerId}`]: newCard,
    });
  }

  async function goToGames() {
    await updateDoc(doc(db, "rooms", roomId), { gameStatus: "selecting" });
    navigate(`/game-select/${roomId}`);
  }

  // Cell size based on screen
  const cellSize = isMobile ? "56px" : "62px";

  if (!myCard) {
    return (
      <div style={s.page}>
        <div style={s.loadingWrap}>
          <div style={s.spinner} />
          <p style={s.loadingText}>Setting up your card…</p>
        </div>
      </div>
    );
  }

  const calledNumbers = roomData?.bingo?.calledNumbers || [];
  const calledSet = new Set(calledNumbers);
  const lastNum = calledNumbers[calledNumbers.length - 1];
  const lastCaller = roomData?.bingo?.lastCaller;
  const lineStatus = getLineStatuses(myCard, calledSet);
  const totalLines = countLines(myCard, calledSet);
  const hasBingo = totalLines >= 5;
  const players = roomData?.players || [];

  const letterIndex = lastNum ? Math.floor((lastNum - 1) / 5) : null;
  const callerLetter = letterIndex !== null ? BINGO_LETTERS[letterIndex] : null;

  return (
    <div style={s.page}>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes popIn   { 0%{transform:scale(0.4);opacity:0} 65%{transform:scale(1.18)} 100%{transform:scale(1);opacity:1} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes glow    { 0%,100%{box-shadow:0 0 14px rgba(168,85,247,0.45)} 50%{box-shadow:0 0 38px rgba(168,85,247,0.9)} }
        @keyframes winBounce { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes markPop { 0%{transform:scale(0.7);opacity:0.3} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
        .num-input:focus { outline: none; border-color: #a855f7 !important; box-shadow: 0 0 0 3px rgba(168,85,247,0.25); }
        .call-btn:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
        .call-btn:disabled { opacity: 0.5; cursor: default; }
        .bingo-btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      <div style={s.inner}>

        {/* Top bar */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "16px",
        }}>
          <button style={s.backBtn} onClick={goToGames}>← Games</button>
          <div style={s.roomPill}>🎱 {roomData?.roomCode || "------"}</div>
          <div style={s.playerPills}>
            {players.slice(0, isMobile ? 3 : 5).map((p) => (
              <div key={p.playerId} style={{
                ...s.avatarPill,
                background: p.playerId === playerId
                  ? "linear-gradient(135deg,#a855f7,#6366f1)"
                  : "rgba(255,255,255,0.1)",
              }}>
                {p.nickname.charAt(0).toUpperCase()}
              </div>
            ))}
            {players.length > (isMobile ? 3 : 5) && (
              <div style={s.avatarPill}>+{players.length - (isMobile ? 3 : 5)}</div>
            )}
          </div>
        </div>

        {/* Winner banner */}
        {winner && (
          <div style={{ ...s.winnerBanner, animation: "winBounce 1.5s ease-in-out infinite" }}>
            <span style={{ fontSize: isMobile ? "24px" : "36px" }}>🎉</span>
            <div style={{ textAlign: "center" }}>
              <div style={{ ...s.winnerTitle, fontSize: isMobile ? "24px" : "32px" }}>BINGO!</div>
              <div style={s.winnerSub}>
                {winner.playerId === playerId ? "🏆 You won!" : `${winner.nickname} won!`}
              </div>
            </div>
            <span style={{ fontSize: isMobile ? "24px" : "36px" }}>🎉</span>
            {isHost && (
              <button style={s.restartBtn} onClick={restartGame}>Play Again</button>
            )}
          </div>
        )}

        {/* Main layout: stacked on mobile, side-by-side on desktop */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "auto 1fr",
          gap: isMobile ? "16px" : "28px",
          alignItems: "start",
        }}>

          {/* ── LEFT: Bingo Card ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={s.cardTopRow}>
              <span style={s.cardLabelText}>YOUR CARD</span>
              <span style={s.nickBadge}>{nickname}</span>
            </div>

            {/* BINGO header letters */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(5, ${cellSize})`,
              gap: "4px",
            }}>
              {BINGO_LETTERS.map((l, i) => (
                <div key={l} style={{ ...s.headerCell, color: LETTER_COLORS[i] }}>{l}</div>
              ))}
            </div>

            {/* Grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(5, ${cellSize})`,
              gridTemplateRows: `repeat(5, ${cellSize})`,
              gap: "4px",
            }}>
              {myCard.map((row, ri) =>
                row.map((cell, ci) => {
                  const isMarked = calledSet.has(cell);
                  const isJust = cell === justCalled;
                  const isWinLine = isMarked && isCellWinning(ri, ci, lineStatus);
                  const letterCol = Math.floor((cell - 1) / 5);

                  return (
                    <div
                      key={`${ri}-${ci}`}
                      style={{
                        borderRadius: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        overflow: "hidden",
                        cursor: "default",
                        background: isWinLine
                          ? "linear-gradient(135deg, rgba(52,211,153,0.35), rgba(16,185,129,0.25))"
                          : isMarked
                            ? "rgba(168,85,247,0.22)"
                            : "rgba(255,255,255,0.04)",
                        border: isWinLine
                          ? "1.5px solid rgba(52,211,153,0.7)"
                          : isMarked
                            ? "1.5px solid rgba(168,85,247,0.5)"
                            : "1px solid rgba(255,255,255,0.08)",
                        transform: isJust ? "scale(1.12)" : "scale(1)",
                        boxShadow: isJust
                          ? `0 0 22px ${LETTER_COLORS[letterCol]}99`
                          : isWinLine
                            ? "0 0 10px rgba(52,211,153,0.4)"
                            : "none",
                        transition: "all 0.22s ease",
                        animation: isJust ? "markPop 0.35s ease both" : "none",
                      }}
                    >
                      <span style={{
                        fontSize: isMarked ? (isMobile ? "15px" : "17px") : (isMobile ? "14px" : "16px"),
                        fontWeight: isMarked ? "800" : "500",
                        color: isWinLine ? "#34d399" : isMarked ? "#c084fc" : "rgba(255,255,255,0.75)",
                        position: "relative",
                        zIndex: 1,
                        transition: "color 0.2s ease, font-size 0.2s ease",
                      }}>
                        {cell}
                      </span>
                      {isMarked && (
                        <div style={{
                          position: "absolute",
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          bottom: "4px",
                          right: "4px",
                          opacity: 0.8,
                          background: isWinLine ? "#34d399" : "#a855f7",
                        }} />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Progress */}
            <div style={{ marginTop: "2px" }}>
              <div style={s.progressText}>{totalLines} / 5 lines completed</div>
              <div style={s.progressTrack}>
                <div style={{
                  ...s.progressFill,
                  width: `${(totalLines / 5) * 100}%`,
                  background: totalLines >= 5
                    ? "linear-gradient(90deg,#34d399,#10b981)"
                    : "linear-gradient(90deg,#a855f7,#6366f1)",
                }} />
              </div>
            </div>

            {/* Claim button */}
            {hasBingo && !winner && (
              <button
                className="bingo-btn"
                style={{ ...s.bingoBtn, animation: "glow 0.6s ease-in-out infinite" }}
                onClick={claimBingo}
                disabled={claimingBingo}
              >
                {claimingBingo ? "Claiming…" : "🎉 BINGO!"}
              </button>
            )}
          </div>

          {/* ── RIGHT: Caller panel ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* Last called display */}
            <div style={s.callerBox}>
              <div style={s.callerLabel}>LAST CALLED</div>
              {lastNum ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px", lineHeight: 1 }} key={lastNum}>
                  <span style={{
                    fontSize: isMobile ? "32px" : "44px",
                    fontWeight: "900",
                    color: callerLetter ? LETTER_COLORS[BINGO_LETTERS.indexOf(callerLetter)] : "#fff",
                  }}>
                    {callerLetter}
                  </span>
                  <span style={{
                    fontSize: isMobile ? "56px" : "76px",
                    fontWeight: "900",
                    color: callerLetter ? LETTER_COLORS[BINGO_LETTERS.indexOf(callerLetter)] : "#fff",
                    animation: "popIn 0.4s ease both",
                  }}>
                    {lastNum}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: isMobile ? "56px" : "76px", fontWeight: "900", color: "rgba(255,255,255,0.1)" }}>–</div>
              )}
              {lastCaller && (
                <div style={s.callerBy}>
                  called by <strong style={{ color: "#c084fc" }}>
                    {lastCaller.playerId === playerId ? "You" : lastCaller.nickname}
                  </strong>
                </div>
              )}
              <div style={s.calledCount}>{calledNumbers.length} / 25 called</div>
            </div>

            {/* Number input */}
            {!winner && (
              <div style={s.inputBox}>
                <div style={s.inputLabel}>CALL A NUMBER</div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <input
                    ref={inputRef}
                    className="num-input"
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min={1}
                    max={25}
                    value={inputNum}
                    onChange={(e) => { setInputNum(e.target.value); setInputError(""); }}
                    onKeyDown={handleKeyDown}
                    placeholder="1–25"
                    style={s.numInput}
                    disabled={callCooldown}
                  />
                  <button
                    className="call-btn"
                    style={s.callBtn}
                    onClick={callNumber}
                    disabled={callCooldown || !inputNum}
                  >
                    Call!
                  </button>
                </div>
                {inputError && <div style={s.errorMsg}>{inputError}</div>}
                <div style={s.hintText}>Any player can call any uncalled number (1–25)</div>
              </div>
            )}

            {/* Called numbers grid */}
            <div style={s.calledSection}>
              <div style={s.calledTitle}>CALLED NUMBERS</div>
              <div style={s.calledGrid}>
                {Array.from({ length: 25 }, (_, i) => i + 1).map((n) => {
                  const isCalled = calledSet.has(n);
                  const li = Math.floor((n - 1) / 5);
                  return (
                    <div
                      key={n}
                      style={{
                        height: isMobile ? "30px" : "34px",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: isMobile ? "12px" : "13px",
                        fontWeight: isCalled ? "700" : "400",
                        background: isCalled ? `${LETTER_COLORS[li]}22` : "rgba(255,255,255,0.03)",
                        border: isCalled ? `1.5px solid ${LETTER_COLORS[li]}88` : "1px solid rgba(255,255,255,0.06)",
                        color: isCalled ? LETTER_COLORS[li] : "rgba(255,255,255,0.2)",
                        transition: "all 0.25s ease",
                        animation: n === justCalled ? "popIn 0.35s ease both" : "none",
                      }}
                    >
                      {n}
                    </div>
                  );
                })}
              </div>

              {/* BINGO legend */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                {BINGO_LETTERS.map((l, i) => (
                  <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", fontSize: "13px" }}>
                    <span style={{ color: LETTER_COLORS[i], fontWeight: "800" }}>{l}</span>
                    <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "10px" }}>{i * 5 + 1}–{i * 5 + 5}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(160deg, #0d0d1a 0%, #1a0f2e 50%, #0d1a2e 100%)",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: "14px 12px 48px",
    color: "#fff",
    overflowX: "hidden",
    boxSizing: "border-box",
  },
  inner: { maxWidth: "980px", margin: "0 auto" },

  loadingWrap: {
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    minHeight: "100vh", gap: "16px",
  },
  spinner: {
    width: "36px", height: "36px",
    border: "3px solid rgba(168,85,247,0.2)",
    borderTop: "3px solid #a855f7",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: { color: "rgba(255,255,255,0.4)", fontSize: "14px" },

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
  roomPill: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "999px", color: "rgba(255,255,255,0.6)",
    padding: "8px 18px", fontSize: "13px",
    fontWeight: "600", letterSpacing: "2px",
  },
  playerPills: { display: "flex", gap: "6px" },
  avatarPill: {
    width: "32px", height: "32px", borderRadius: "50%",
    background: "rgba(255,255,255,0.1)", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "13px", fontWeight: "700", flexShrink: 0,
  },

  winnerBanner: {
    background: "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(99,102,241,0.2))",
    border: "1px solid rgba(168,85,247,0.5)",
    borderRadius: "20px", padding: "16px 20px",
    marginBottom: "16px",
    display: "flex", alignItems: "center",
    justifyContent: "center", gap: "16px", flexWrap: "wrap",
  },
  winnerTitle: {
    fontSize: "32px", fontWeight: "900",
    letterSpacing: "5px", color: "#fff",
  },
  winnerSub: {
    color: "rgba(255,255,255,0.65)", fontSize: "14px",
    textAlign: "center", marginTop: "2px",
  },
  restartBtn: {
    background: "linear-gradient(135deg,#a855f7,#6366f1)",
    border: "none", borderRadius: "999px",
    color: "#fff", padding: "10px 26px",
    fontSize: "13px", fontWeight: "700", cursor: "pointer",
  },

  cardTopRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", marginBottom: "2px",
  },
  cardLabelText: {
    color: "rgba(255,255,255,0.4)", fontSize: "11px",
    fontWeight: "700", letterSpacing: "2px",
  },
  nickBadge: {
    background: "rgba(168,85,247,0.2)",
    border: "1px solid rgba(168,85,247,0.4)",
    color: "#c084fc", borderRadius: "999px",
    padding: "3px 12px", fontSize: "12px", fontWeight: "600",
  },
  headerCell: {
    height: "36px", borderRadius: "10px",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "18px", fontWeight: "900", letterSpacing: "1px",
    background: "rgba(255,255,255,0.06)",
  },
  progressText: {
    color: "rgba(255,255,255,0.45)", fontSize: "12px",
    fontWeight: "600", marginBottom: "5px", textAlign: "center",
  },
  progressTrack: {
    height: "5px", borderRadius: "999px",
    background: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  progressFill: {
    height: "100%", borderRadius: "999px",
    transition: "width 0.4s ease, background 0.4s ease",
  },
  bingoBtn: {
    background: "linear-gradient(135deg,#34d399,#10b981)",
    border: "none", borderRadius: "14px", color: "#fff",
    fontSize: "18px", fontWeight: "900", letterSpacing: "3px",
    padding: "14px", cursor: "pointer", width: "100%",
    transition: "transform 0.15s ease, filter 0.15s ease",
  },

  callerBox: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "20px", padding: "16px 20px",
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: "4px",
  },
  callerLabel: {
    color: "rgba(255,255,255,0.35)", fontSize: "11px",
    fontWeight: "700", letterSpacing: "2px",
  },
  callerBy: {
    color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "2px",
  },
  calledCount: {
    color: "rgba(255,255,255,0.3)", fontSize: "12px",
    fontWeight: "600", marginTop: "2px",
  },

  inputBox: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: "18px", padding: "16px 18px",
    display: "flex", flexDirection: "column", gap: "10px",
  },
  inputLabel: {
    color: "rgba(255,255,255,0.35)", fontSize: "11px",
    fontWeight: "700", letterSpacing: "2px",
  },
  numInput: {
    flex: 1, background: "rgba(255,255,255,0.06)",
    border: "1.5px solid rgba(255,255,255,0.12)",
    borderRadius: "12px", color: "#fff",
    fontSize: "20px", fontWeight: "700", textAlign: "center",
    padding: "10px", outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  },
  callBtn: {
    background: "linear-gradient(135deg,#a855f7,#6366f1)",
    border: "none", borderRadius: "12px", color: "#fff",
    fontSize: "15px", fontWeight: "700", padding: "10px 22px",
    cursor: "pointer",
    transition: "filter 0.15s ease, transform 0.15s ease",
  },
  errorMsg: {
    color: "#f87171", fontSize: "13px", fontWeight: "600",
    animation: "slideIn 0.2s ease both",
  },
  hintText: {
    color: "rgba(255,255,255,0.28)", fontSize: "11px", lineHeight: 1.4,
  },

  calledSection: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "18px", padding: "14px 16px",
  },
  calledTitle: {
    color: "rgba(255,255,255,0.3)", fontSize: "10px",
    fontWeight: "700", letterSpacing: "2px",
    textTransform: "uppercase", marginBottom: "10px",
  },
  calledGrid: {
    display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "5px",
    marginBottom: "8px",
  },
};
