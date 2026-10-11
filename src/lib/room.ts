const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidRoomId(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

export function channelName(roomId: string): string {
  return `room:${roomId}`;
}
