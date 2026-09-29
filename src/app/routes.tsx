import { createBrowserRouter } from "react-router-dom";
import { GameApp } from "./App";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      Component: GameApp,
    },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);
