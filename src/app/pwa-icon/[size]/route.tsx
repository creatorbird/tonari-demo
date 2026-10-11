import { renderAppIcon } from "@/lib/appIcon";

// manifest から参照する Android 向けのアイコン（192px はホーム画面、512px は起動画面に使われる）
const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export const dynamicParams = false;

export async function GET(_request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await params;
  return renderAppIcon(Number(size));
}
