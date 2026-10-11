import { BiText } from "@/components/BiText";

export function RoomEnded({ lang }: { lang: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <p className="text-5xl">👋</p>
      <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
        <BiText lang={lang} k="roomEnded" />
      </h1>
    </main>
  );
}
