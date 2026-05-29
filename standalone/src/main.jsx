import React from "react";
import { createRoot } from "react-dom/client";
import DropBoardApp from "../../src/DropBoardApp.js";

const DESIGN_FONT_LINKS = [
  {
    rel: "preconnect",
    href: "https://fonts.googleapis.com"
  },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous"
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Vollkorn:wght@400;500;600;700&family=Montserrat:wght@400;500;600&display=swap"
  }
];

function ensureFonts() {
  if (typeof document === "undefined") return;
  for (const link of DESIGN_FONT_LINKS) {
    const selector = `link[href="${link.href}"]`;
    if (document.head.querySelector(selector)) continue;
    const el = document.createElement("link");
    el.rel = link.rel;
    el.href = link.href;
    if (link.crossOrigin) el.crossOrigin = link.crossOrigin;
    document.head.appendChild(el);
  }
}

function ErrorView({ error }) {
  return (
    <div style={{
      fontFamily: "Vollkorn, Georgia, serif",
      padding: "24px",
      color: "#1d1d1f",
      background: "#ffffff",
      minHeight: "100vh",
      whiteSpace: "pre-wrap"
    }}>
      <h1 style={{ marginTop: 0, fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1.08, fontWeight: 600 }}>DropBoard failed to start</h1>
      <p>The standalone launcher hit an error before the board UI could render.</p>
      <pre style={{
        background: "#fafafa",
        border: "1px solid #e0e0e0",
        borderRadius: "4px",
        padding: "16px",
        overflow: "auto"
      }}>
        {String(error?.stack || error?.message || error)}
      </pre>
    </div>
  );
}

class StartupBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      return <ErrorView error={this.state.error} />;
    }
    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    createRoot(rootEl).render(<ErrorView error={event.error || event.message} />);
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    createRoot(rootEl).render(<ErrorView error={event.reason} />);
  }
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing root element");
}

ensureFonts();

createRoot(rootEl).render(
  <StartupBoundary>
    <DropBoardApp
      boardId="standalone"
      boardMode="linked"
      allowDeleteBoard={false}
    />
  </StartupBoundary>
);
