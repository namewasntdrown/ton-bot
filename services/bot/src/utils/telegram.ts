export type ViewMode = 'reply' | 'edit';

export async function sendView(
  ctx: any,
  text: string,
  extra: Record<string, any>,
  mode: ViewMode = 'edit'
) {
  if (mode === 'reply') {
    return ctx.reply(text, extra);
  }
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err: any) {
    const desc = String(err?.description || err?.message || '');
    if (desc.includes('message is not modified')) return;
    if (
      desc.includes('message to edit not found') ||
      desc.includes('message identifier not specified')
    ) {
      return ctx.reply(text, extra);
    }
    throw err;
  }
}
