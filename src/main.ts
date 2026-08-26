import "./styles.css";
import { EditorApp } from "./app/EditorApp";

const host = document.querySelector<HTMLElement>("#app");
if (!host) {
  throw new Error("Application host #app was not found");
}

const app = new EditorApp(host);
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
