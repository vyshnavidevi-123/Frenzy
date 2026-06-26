// Home.jsx
import { useNavigate } from "react-router-dom";

function Home() {
  const navigate = useNavigate();

  const paths = [
    {
      label: "Create Room",
      desc: "Start a new adventure and invite people in",
      icon: "✦",
      to: "/create-room",
    },
    {
      label: "Join Room",
      desc: "Got a code? Drop into a friend's session",
      icon: "◈",
      to: "/join-room",
    },
    {
      label: "Play with Strangers",
      desc: "Get matched into a room, right now",
      icon: "✺",
      to: "/play-with-strangers",
    },
  ];

  return (
    <div style={s.page}>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={s.inner}>
        <div style={s.heading}>

          
          <h1 style={s.title}>
            Fren<span style={s.titleAccent}>zyyy</span>
          </h1>
          <p style={s.sub}>Play mini games with friends or strangers.</p>
        </div>

        <div style={s.card}>
          {paths.map((p, i) => (
            <button
              key={p.to}
              onClick={() => navigate(p.to)}
              style={{
                ...s.pathButton,
                ...(i === paths.length - 1 ? { marginBottom: 0 } : {}),
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(168,85,247,0.5)";
                e.currentTarget.style.background = "rgba(168,85,247,0.1)";
                e.currentTarget.style.transform = "translateX(4px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                e.currentTarget.style.transform = "translateX(0)";
              }}
            >
              <span style={s.pathIcon}>{p.icon}</span>
              <span style={s.pathText}>
                <span style={s.pathLabel}>{p.label}</span>
                <span style={s.pathDesc}>{p.desc}</span>
              </span>
              <span style={s.pathArrow}>→</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(160deg, #0d0d1a 0%, #1a0f2e 50%, #0d1a2e 100%)",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: "24px 16px 48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  inner: { width: "100%", maxWidth: "420px" },
  heading: { textAlign: "center", marginBottom: "28px", animation: "fadeUp 0.4s ease both" },
  iconWrap: {
    width: "64px",
    height: "64px",
    borderRadius: "18px",
    background: "rgba(168,85,247,0.14)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 18px",
    boxShadow: "0 0 24px rgba(168,85,247,0.25)",
  },
  iconGlyph: { fontSize: "26px", color: "#c084fc" },
  eyebrow: {
    margin: "0 0 10px",
    fontSize: "12px",
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: "#c084fc",
    fontWeight: 700,
  },
  title: {
    margin: "0 0 10px",
    fontSize: "clamp(32px, 7vw, 40px)",
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "#fff",
  },
  titleAccent: {
    background: "linear-gradient(135deg, #a855f7, #6366f1)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  sub: {
    margin: 0,
    fontSize: "15px",
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.45)",
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "20px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    animation: "fadeUp 0.4s ease 0.1s both",
  },
  pathButton: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    width: "100%",
    padding: "16px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "14px",
    cursor: "pointer",
    textAlign: "left",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
  },
  pathIcon: {
    flexShrink: 0,
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "10px",
    background: "rgba(168,85,247,0.14)",
    color: "#c084fc",
    fontSize: "18px",
  },
  pathText: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  pathLabel: {
    fontSize: "15px",
    fontWeight: 700,
    color: "#fff",
  },
  pathDesc: {
    fontSize: "12.5px",
    color: "rgba(255,255,255,0.45)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  pathArrow: {
    flexShrink: 0,
    color: "#a855f7",
    fontSize: "18px",
  },
};

export default Home;
