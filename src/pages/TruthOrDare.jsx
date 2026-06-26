// TruthOrDare.jsx
// Mode select (host) → turn rotation → Truth or Dare choice → reveal prompt → skip/done → next player

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { TOD_MODES, getRandomPrompt } from "../truthOrDareBank";

const SKIP_LIMIT = 2; // skips allowed per player per game

export default function TruthOrDare() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);

  const nickname = sessionStorage.getItem("playverse_nickname") || "Player";
  const isHost = sessionStorage.getItem("playverse_isHost") === "true";

  useEffect(() => {
    if (!roomId) { navigate("/"); return; }
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) { navigate("/"); return; }
      setRoom(snap.data());
      setLoading(false);
    });
    return () => unsub();
  }, [roomId, navigate]);

  const game = room?.todGame;
  const players = room?.players || [];
  const currentPlayer = game?.order?.[game.turnIndex];
  const isMyTurn = currentPlayer === nickname;
  const mySkips = game?.skipsUsed?.[nickname] || 0;

  async function startGame(mode) {
    if (!isHost) return;
    const order = players.map((p) => p.nickname).sort(() => Math.random() - 0.5);
    await updateDoc(doc(db, "rooms", roomId), {
      todGame: {
        mode,
        order,
        turnIndex: 0,
        phase: "choosing", // choosing | revealed
        currentType: null, // "truth" | "dare"
        currentPrompt: null,
        skipsUsed: Object.fromEntries(order.map((n) => [n, 0])),
        completedCount: Object.fromEntries(order.map((n) => [n, 0])),
      },
    });
  }

  async function chooseType(type) {
    if (!isMyTurn || game.phase !== "choosing") return;
    const prompt = getRandomPrompt(game.mode, type);
    await updateDoc(doc(db, "rooms", roomId), {
      "todGame.phase": "revealed",
      "todGame.currentType": type,
      "todGame.currentPrompt": prompt,
    });
  }

  async function reroll() {
    if (!isMyTurn || game.phase !== "revealed") return;
    if (mySkips >= SKIP_LIMIT) return;
    const prompt = getRandomPrompt(game.mode, game.currentType);
    await updateDoc(doc(db, "rooms", roomId), {
      "todGame.currentPrompt": prompt,
      [`todGame.skipsUsed.${nickname}`]: mySkips + 1,
    });
  }

  async function nextTurn() {
    if (!isMyTurn) return;
    const completed = game.completedCount[nickname] || 0;
    const nextIndex = (game.turnIndex + 1) % game.order.length;
    await updateDoc(doc(db, "rooms", roomId), {
      "todGame.turnIndex": nextIndex,
      "todGame.phase": "choosing",
      "todGame.currentType": null,
      "todGame.currentPrompt": null,
      [`todGame.completedCount.${nickname}`]: completed + 1,
    });
  }

  async function goToGames() {
    await updateDoc(doc(db, "rooms", roomId), {
      gameStatus: "selecting",
    });

    navigate(`/game-select/${roomId}`);
  }


  async function backToLobby() {
    await updateDoc(doc(db, "rooms", roomId), {
      status: "waiting", selectedGame: null, todGame: null,
    });
    navigate(`/lobby/${roomId}`);
  }

  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <p style={{ color: "rgba(255,255,255,0.5)", marginTop: "16px" }}>Loading…</p>
      </div>
    );
  }

  // ── MODE SELECT ──────────────────────────────────────────────────────────
  if (!game) {
    return (
      <div style={s.page}>
        <style>{globalAnim}</style>
        <div style={s.container}>
          <div style={s.center2}>
          <button style={s.backBtn} onClick={goToGames}>

← Games

</button>
            <div style={s.bigEmoji}></div>
            <h1 style={s.title}>Truth or Dare</h1>
            {isHost ? (
              <>
                <p style={s.sub}>Pick an intensity level for the group</p>
                <div style={s.modeGrid}>
                  {Object.entries(TOD_MODES).map(([key, m]) => (
                    <button
                      key={key}
                      style={{ ...s.modeBtn, border: `1px solid ${m.color}44` }}
                      onClick={() => startGame(key)}
                    >
                      <span style={{ fontSize: "30px" }}>{m.emoji}</span>
                      <span style={{ ...s.modeLabel, color: m.color }}>{m.label}</span>
                      <span style={s.modeDesc}>{m.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p style={s.sub}>Waiting for host to pick an intensity level…</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const modeInfo = TOD_MODES[game.mode];

  return (
    <div style={s.page}>
      <style>{globalAnim}</style>
      <div style={s.container}>

        {/* Top bar */}
        <div style={s.topBar}>
        <button style={s.backBtn} onClick={() => navigate(`/game-select/${roomId}`)}>
  ← Games
</button>
          <div style={{ ...s.modeBadge, color: modeInfo.color, border: `1px solid ${modeInfo.color}44` }}>
            {modeInfo.emoji} {modeInfo.label}
          </div>
          <div style={s.turnBadge}> {currentPlayer}'s turn</div>
        </div>

        {/* CHOOSING PHASE */}
        {game.phase === "choosing" && (
          <div style={s.center2}>
            {isMyTurn ? (
              <>
                <div style={s.bigEmoji}>🎲</div>
                <h2 style={s.qTitle}>Your turn — choose wisely</h2>
                <div style={s.chooseRow}>
                  <button style={{ ...s.choiceBtn, ...s.truthBtn }} onClick={() => chooseType("truth")}>
                    Truth
                  </button>
                  <button style={{ ...s.choiceBtn, ...s.dareBtn }} onClick={() => chooseType("dare")}>
                    Dare
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={s.bigEmoji}>👀</div>
                <h2 style={s.qTitle}>{currentPlayer} is choosing…</h2>
                <p style={s.sub}>Truth or Dare?</p>
              </>
            )}
          </div>
        )}

        {/* REVEALED PHASE */}
        {game.phase === "revealed" && (
          <div style={s.center2}>
            <div style={{
              ...s.promptCard,
              border: `1px solid ${game.currentType === "truth" ? "#60a5fa44" : "#f8717144"}`,
              background: game.currentType === "truth" ? "rgba(96,165,250,0.08)" : "rgba(248,113,113,0.08)",
            }}>
              <span style={s.promptTag}>
                {game.currentType === "truth" ? "TRUTH" : "DARE"}
              </span>
              <p style={s.promptText}>{game.currentPrompt}</p>
            </div>

            {isMyTurn ? (
              <div style={s.actionRow}>
                <button
                  style={{ ...s.skipBtn, opacity: mySkips >= SKIP_LIMIT ? 0.4 : 1 }}
                  onClick={reroll}
                  disabled={mySkips >= SKIP_LIMIT}
                >
                  🔄 Reroll ({SKIP_LIMIT - mySkips} left)
                </button>
                <button style={s.doneBtn} onClick={nextTurn}>
                  ✅ Done — Next Player
                </button>
              </div>
            ) : (
              <p style={s.waitHostNote}>Waiting for {currentPlayer} to finish…</p>
            )}
          </div>
        )}

        {/* Players strip */}
        <div style={s.playersStrip}>
          {game.order.map((name) => (
            <div key={name} style={{
              ...s.playerChip,
              ...(name === currentPlayer ? s.playerChipActive : {}),
            }}>
              {name} · {game.completedCount[name] || 0}
            </div>
          ))}
        </div>

        {isHost && (
          <button style={s.endBtn} onClick={backToLobby}>End Game & Return to Lobby</button>
        )}
      </div>
    </div>
  );
}

const globalAnim = `
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes popIn { from{opacity:0; transform:scale(0.95)} to{opacity:1; transform:scale(1)} }
`;

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
    background: "linear-gradient(160deg, #1a0d0d 0%, #2e0f1f 50%, #1a0d2e 100%)",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: "20px 16px 40px",
  },
  container: { maxWidth: "640px", margin: "0 auto" },
  center: {
    minHeight: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "linear-gradient(160deg, #1a0d0d 0%, #2e0f1f 50%, #1a0d2e 100%)",
  },
  center2: { textAlign: "center", padding: "30px 10px", animation: "popIn 0.3s ease" },
  spinner: {
    width: "40px", height: "40px", border: "3px solid rgba(255,255,255,0.1)",
    borderTop: "3px solid #ec4899", borderRadius: "50%", animation: "spin 0.8s linear infinite",
  },
  bigEmoji: { fontSize: "52px", marginBottom: "10px" },
  title: { color: "#fff", fontSize: "30px", fontWeight: "800", margin: "0 0 10px" },
  qTitle: { color: "#fff", fontSize: "22px", fontWeight: "800", margin: "0 0 20px" },
  sub: { color: "rgba(255,255,255,0.45)", fontSize: "14px", margin: "0 0 28px" },
  modeGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px",
  },
  modeBtn: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
    background: "rgba(255,255,255,0.05)", borderRadius: "16px", padding: "20px 14px",
    cursor: "pointer", transition: "transform 0.15s",
  },
  modeLabel: { fontWeight: "800", fontSize: "15px" },
  modeDesc: { color: "rgba(255,255,255,0.4)", fontSize: "11px", textAlign: "center", lineHeight: 1.4 },
  topBar: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    flexWrap: "wrap", gap: "10px", marginBottom: "20px",
  },
  modeBadge: {
    background: "rgba(255,255,255,0.06)", borderRadius: "999px",
    padding: "8px 16px", fontSize: "13px", fontWeight: "700",
  },
  turnBadge: {
    background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)",
    color: "#c084fc", borderRadius: "999px", padding: "8px 16px",
    fontSize: "13px", fontWeight: "700",
  },
  chooseRow: { display: "flex", gap: "16px", justifyContent: "center" },
  choiceBtn: {
    padding: "28px 36px", borderRadius: "18px", border: "none",
    color: "#fff", fontSize: "18px", fontWeight: "800", cursor: "pointer",
    transition: "transform 0.15s",
  },
  truthBtn: { background: "linear-gradient(135deg, #3b82f6, #2563eb)", boxShadow: "0 4px 24px rgba(59,130,246,0.4)" },
  dareBtn: { background: "linear-gradient(135deg, #f87171, #dc2626)", boxShadow: "0 4px 24px rgba(248,113,113,0.4)" },
  promptCard: {
    borderRadius: "20px", padding: "32px 24px", marginBottom: "20px",
    display: "flex", flexDirection: "column", alignItems: "center", gap: "12px",
  },
  promptTag: {
    fontSize: "12px", fontWeight: "800", letterSpacing: "1px",
    color: "rgba(255,255,255,0.5)",
  },
  promptText: {
    color: "#fff", fontSize: "19px", fontWeight: "700", lineHeight: 1.5, margin: 0,
  },
  actionRow: { display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" },
  skipBtn: {
    padding: "14px 20px", borderRadius: "12px",
    background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
    color: "#fff", fontSize: "14px", fontWeight: "700", cursor: "pointer",
  },
  doneBtn: {
    padding: "14px 28px", borderRadius: "12px", border: "none",
    background: "linear-gradient(135deg, #4ade80, #16a34a)", color: "#fff",
    fontSize: "14px", fontWeight: "700", cursor: "pointer",
    boxShadow: "0 4px 20px rgba(74,222,128,0.3)",
  },
  waitHostNote: { color: "rgba(255,255,255,0.3)", fontSize: "13px" },
  playersStrip: {
    display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center",
    marginTop: "32px", marginBottom: "16px",
  },
  playerChip: {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "999px", padding: "6px 14px", color: "rgba(255,255,255,0.5)",
    fontSize: "11px", fontWeight: "600",
  },
  playerChipActive: {
    border: "1px solid rgba(168,85,247,0.4)", background: "rgba(168,85,247,0.1)", color: "#c084fc",
  },
  endBtn: {
    display: "block", margin: "0 auto", background: "none",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
    color: "rgba(255,255,255,0.35)", padding: "10px 20px",
    cursor: "pointer", fontSize: "12px",
  },
};
