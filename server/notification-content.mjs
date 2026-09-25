// Bound Unicode text so even multipart SMS fits inside a Web Push payload.
function preview(value, limit) {
  const characters = Array.from(typeof value === 'string' ? value : '');
  return characters.length > limit
    ? characters.slice(0, limit - 1).join('') + '…'
    : characters.join('');
}

export function smsNotification(sms, name) {
  const sender = preview(name || sms.number || 'New message', 80);
  return {
    type: 'sms',
    title: `${sender} · SIM ${sms.sim || '?'}`,
    body: preview(sms.text, 500) || 'Empty message',
    conversationId: sms.conversationId,
  };
}
