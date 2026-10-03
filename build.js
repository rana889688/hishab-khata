import fs from "fs";
import path from "path";
import { ensureEmbeddedDistExists } from "./embedded_dist.js";

console.log("🚀 [Build]: Render build process started...");

const distDir = path.resolve(process.cwd(), "dist");
ensureEmbeddedDistExists(distDir);

console.log("✅ [Build]: All production frontend and backend assets verified!");
process.exit(0);
