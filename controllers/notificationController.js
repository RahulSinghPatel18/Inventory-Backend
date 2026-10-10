const Notification = require("../models/Notification");
const { isValidObjectId, parsePagination } = require("../utils/requestValidation");
const notificationHub = require("../utils/notificationHub");

const toNotification = (notification, userId) => ({
  _id: notification._id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  entityType: notification.entityType,
  entityId: notification.entityId,
  createdAt: notification.createdAt,
  isRead: notification.readBy.some((id) => String(id) === String(userId))
});

const listNotifications = async (req, res, next) => {
  try {
    const pagination = parsePagination({ ...req.query, limit: req.query.limit ?? "20" });
    if (!pagination) return res.status(400).json({ message: "Invalid page or limit" });

    const supportedTypes = ["stock-low", "stock-out", "stock-activity", "sale-created"];
    let types;
    if (req.query.types !== undefined) {
      if (typeof req.query.types !== "string") {
        return res.status(400).json({ message: "Notification types must be a comma-separated list" });
      }
      types = [...new Set(req.query.types.split(","))];
      if (!types.length || types.some((type) => !supportedTypes.includes(type))) {
        return res.status(400).json({ message: "Unsupported notification type" });
      }
    }
    const filter = {
      organizationId: req.user.organizationId,
      ...(types ? { type: { $in: types } } : {})
    };
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .select("type title message entityType entityId createdAt readBy")
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      Notification.countDocuments({ ...filter, readBy: { $ne: req.user.userId } })
    ]);

    return res.json({
      notifications: notifications.map((notification) => toNotification(notification, req.user.userId)),
      unreadCount
    });
  } catch (error) {
    return next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid notification ID" });
  }

  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.user.organizationId
      },
      { $addToSet: { readBy: req.user.userId } },
      { returnDocument: "after" }
    ).select("type title message entityType entityId createdAt readBy").lean();

    if (!notification) return res.status(404).json({ message: "Notification not found" });
    return res.json({ notification: toNotification(notification, req.user.userId) });
  } catch (error) {
    return next(error);
  }
};

const markAllNotificationsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      {
        organizationId: req.user.organizationId,
        readBy: { $ne: req.user.userId }
      },
      { $addToSet: { readBy: req.user.userId } }
    );
    return res.json({ message: "Notifications marked as read" });
  } catch (error) {
    return next(error);
  }
};

const streamNotifications = (req, res) => {
  const maxConnectionMs = 15 * 60 * 1000;
  const tokenLifetimeMs = Number.isFinite(req.user.exp)
    ? Math.max(0, req.user.exp * 1000 - Date.now())
    : maxConnectionMs;
  const connectionLifetimeMs = Math.min(maxConnectionMs, tokenLifetimeMs);
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();

  const unsubscribe = notificationHub.subscribe(req.user.organizationId, res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(": keep-alive\n\n");
  }, 25_000);
  const expireConnection = setTimeout(() => res.end(), connectionLifetimeMs);

  res.write("event: ready\ndata: {}\n\n");
  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(expireConnection);
    unsubscribe();
  });
};

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  streamNotifications
};
