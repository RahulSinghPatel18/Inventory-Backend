const subscribers = new Map();

const subscribe = (organizationId, response) => {
  const key = String(organizationId);
  const connections = subscribers.get(key) || new Set();
  connections.add(response);
  subscribers.set(key, connections);

  return () => {
    connections.delete(response);
    if (connections.size === 0) subscribers.delete(key);
  };
};

const publish = (notification) => {
  const connections = subscribers.get(String(notification.organizationId));
  if (!connections?.size) return;

  const event = `event: notification\ndata: ${JSON.stringify({
    _id: notification._id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    entityType: notification.entityType,
    entityId: notification.entityId,
    createdAt: notification.createdAt
  })}\n\n`;
  for (const response of connections) {
    if (response.writableEnded || response.destroyed) {
      connections.delete(response);
      continue;
    }
    try {
      response.write(event);
    } catch (error) {
      connections.delete(response);
      console.warn(`Notification stream write failed (${error.name || "Error"})`);
    }
  }
  if (connections.size === 0) subscribers.delete(String(notification.organizationId));
};

module.exports = { subscribe, publish };
