import { test as baseTest } from "vitest";
import { Torus } from "./torus.js";
import { TorusDriver } from "../driver/torus.js";
export const test = baseTest.extend("torus", () => new Torus(new TorusDriver()));
