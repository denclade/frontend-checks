import styles from "./Panel.module.scss";

export function Panel() {
  const inside = (target: HTMLElement) => target.closest(".panel__menu");
  const scoped = (target: HTMLElement) => target.closest(`.${styles.panelMenu}`);
  const editor = (root: HTMLElement) => root.querySelector(".cm-editor .cm-gutters");
  return <div class={styles.panel} data-x={styles.panelMissing} />;
}
