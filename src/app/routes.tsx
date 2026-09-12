import { createBrowserRouter } from "react-router-dom";
import { GameApp } from "./App";
import { OAuthConsent } from "./components/OAuthConsent";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      Component: GameApp,
    },
    {
      path: "/oauth/consent",
      Component: OAuthConsent,
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
