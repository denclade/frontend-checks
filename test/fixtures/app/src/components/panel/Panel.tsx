import styles from "./Panel.module.scss";

export function Panel() {
  const inside = (target: HTMLElement) => target.closest(".panel__menu");
  const scoped = (target: HTMLElement) => target.closest(`.${styles.panelMenu}`);
  const editor = (root: HTMLElement) => root.querySelector(".cm-editor .cm-gutters");
  const open = (el: HTMLElement) => {
    el.classList.add("panel__menu");
    el.classList.toggle("cm-editor");
  };
  return <div class={styles.panel} data-x={styles.panelMissing}>
    <p class="panel__menu sr-only" classList={{["panel__menu"]: true, [styles.panelMenu]: true, "cm-gutters": true}} />
  </div>;
}
