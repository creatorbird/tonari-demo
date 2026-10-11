"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "translator:handsFree";

/**
 * 常時音声認識（ハンズフリー）モードの ON/OFF。
 * 騒がしい場所での誤送信を避けるため初期値は手動モードにし、選んだモードは端末に記憶する。
 */
export function useHandsFreeMode() {
  const [handsFree, setHandsFreeState] = useState(false);

  useEffect(() => {
    try {
      // サーバー側では localStorage が無いため、マウント後に読み込む
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandsFreeState(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ストレージが使えない環境では手動モードのまま
    }
  }, []);

  const setHandsFree = useCallback((value: boolean) => {
    setHandsFreeState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // 記憶できなくても切り替え自体は有効
    }
  }, []);

  return { handsFree, setHandsFree };
}
