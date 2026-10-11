/**
 * 触覚フィードバック（Android の Chrome など navigator.vibrate に対応した端末だけ）。
 * iOS Safari は対応していないので何も起きない。音は鳴らさない（マイクが拾って誤認識するため）
 */
const PATTERNS = {
  /** ボタンを押した瞬間の、ごく短いコツッという手応え */
  tap: 8,
  /** 送信したとき */
  send: 14,
  /** 相手の発言が届いたとき */
  receive: [10, 60, 10],
  /** 相手とつながったとき */
  success: [16, 70, 16, 70, 28],
} satisfies Record<string, VibratePattern>;

export type HapticKind = keyof typeof PATTERNS;

export function haptic(kind: HapticKind): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // 一度もタップしていないページなど、ブラウザが振動を許可しないときは黙って諦める
  }
}
