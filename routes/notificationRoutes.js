const express = require("express");
const jwtMiddleware = require("../middleware/jwtMiddleware");
const permission = require("../middleware/permissionMiddleware");
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
  streamNotifications
} = require("../controllers/notificationController");

const router = express.Router();

router.use(jwtMiddleware, permission("notifications.view"));
router.get("/stream", streamNotifications);
router.get("/", listNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.delete("/", dismissAllNotifications);
router.patch("/:id/read", markNotificationRead);
router.delete("/:id", dismissNotification);

module.exports = router;
