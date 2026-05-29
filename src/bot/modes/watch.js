export function handleWatch(extracted, ctx) {
  ctx.logger.info('watch', 'Mensaje observado', {
    groupId: extracted.groupId,
    senderId: extracted.senderId,
    mediaType: extracted.mediaType,
    text: extracted.text?.slice(0, 250) || '',
  });
  return true;
}
