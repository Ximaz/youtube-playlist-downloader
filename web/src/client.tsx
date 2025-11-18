import { hc } from "hono/client";
import { useState } from "hono/jsx";
import { render } from "hono/jsx/dom";
import type { AppType } from ".";
import "./style.css";
import { Counter } from "./components/counter";
import { ClockButton } from "./components/clock-button";

const client = hc<AppType>("/");

export type ClientType = typeof client;

const App = () => (
  <>
    <div class="text-2xl text-red-600 grid h-dvh items-center justify-center text-center">
      <div>
        <h1 class="text-4xl font-bold">Hello there!</h1>
        <p class="font-mono">
          Bun, Hono, Vite, TailwindCSS <br />
          🔥🔥🔥🔥🔥🔥🔥🔥🔥
        </p>
      </div>
    </div>
    <h1>Hello hono/jsx/dom!</h1>
    <h2>Example of useState()</h2>
    <Counter />
    <h2>Example of API fetch()</h2>
    <ClockButton client={client} />
  </>
);

const root = document.getElementById("root")!;
render(<App />, root);
