import React from "react";
import { createRoot } from "react-dom/client";
import { DropBoardApp } from "@adrian3/dropboard-core";

createRoot(document.getElementById("root")).render(
  <DropBoardApp
    boardId="standalone"
    boardMode="linked"
    allowDeleteBoard={false}
  />
);
