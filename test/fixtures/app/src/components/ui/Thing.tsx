import * as m from "../../paraglide/messages.js";
import { route } from "../../routes/Page";
export const Thing = () => (
  <div>
    <button onClick={() => {}}><Icon /></button>
    <button title={m.greeting({ name: "x" })}><Icon /></button>
    <img src="a.png" />
    <div onClick={() => go()}>x</div>
    <span role="button">y</span>
    <p>{m.missing_key()}</p>
  </div>
);
