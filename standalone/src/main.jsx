import React from "react";
import { createRoot } from "react-dom/client";
import DropBoardApp from "../../src/DropBoardApp.js";

function ErrorView({ error }) {
  return (
    <div style={{
      fontFamily: "Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif",
      padding: "24px",
      color: "#1e1f25",
      background: "#ececec",
      minHeight: "100vh",
      whiteSpace: "pre-wrap"
    }}>
      <h1 style={{ marginTop: 0, fontSize: "28px" }}>DropBoard failed to start</h1>
      <p>The standalone launcher hit an error before the board UI could render.</p>
      <pre style={{
        background: "#fff",
        border: "1px solid #cfcfd2",
        borderRadius: "12px",
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

createRoot(rootEl).render(
  <StartupBoundary>
    <DropBoardApp
      boardId="standalone"
      boardMode="linked"
      allowDeleteBoard={false}
    />
  </StartupBoundary>
);
