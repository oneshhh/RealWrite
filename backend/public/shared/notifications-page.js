(async function () {
  const requiredRole = document.body.dataset.requiredRole || "";
  const user = requiredRole ? await APP.requireRole(requiredRole) : await APP.requireAuth();
  if (!user) return;

  await renderTopbar({ role: user.role, links: [] });

  let lastSignature = null;
  let lastUnread = null;
  const rows = document.getElementById("rows");
  const msg = document.getElementById("msg");
  const notificationTotal = document.getElementById("notificationTotal");
  const notificationUnread = document.getElementById("notificationUnread");
  const notificationRead = document.getElementById("notificationRead");

  function setMessage(text) {
    msg.textContent = text || "";
    msg.classList.toggle("hidden", !text);
  }

  function renderEmpty(text) {
    rows.innerHTML = `<tr><td colspan="7" class="writer-empty-row">${APP.escapeHtml(text)}</td></tr>`;
  }

  function notificationTypeLabel(type) {
    const value = String(type || "update").replace(/_/g, " ").trim();
    return value ? value[0].toUpperCase() + value.slice(1) : "Update";
  }

  function notificationHref(notification) {
    const articleId = notification?.payload?.article_id;
    const paymentId = notification?.payload?.payment_id;
    const requestId = notification?.payload?.request_id;
    const projectId = notification?.payload?.project_id;
    const type = String(notification?.type || "");

    if (type.startsWith("payment")) {
      return user.role === "writer" ? `/writer/earnings.html?payment=${encodeURIComponent(paymentId || "")}` : null;
    }
    if (type.startsWith("article_") && articleId) {
      return user.role === "writer" ? `/writer/dashboard.html?article=${encodeURIComponent(articleId)}` : null;
    }
    if (type === "project_request" && requestId) {
      return user.role === "writer" ? `/writer/dashboard.html?request=${encodeURIComponent(requestId)}` : null;
    }
    if (type === "project_request_response" && requestId && projectId) {
      return user.role === "manager"
        ? `/manager/project-detail.html?id=${encodeURIComponent(projectId)}&request=${encodeURIComponent(requestId)}`
        : null;
    }
    if (type === "project_request_submission" && articleId) {
      return user.role === "manager" ? `/manager/review.html?id=${encodeURIComponent(articleId)}` : null;
    }
    return null;
  }

  async function markRead(id) {
    await APP.apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
  }

  function renderRows(notifications) {
    if (!notifications?.length) {
      renderEmpty("No notifications yet.");
      return;
    }

    rows.innerHTML = notifications
      .map((notification) => {
        const href = notificationHref(notification);
        const createdAt = new Date(notification.created_at);
        return `<tr>
          <td data-label="Status">${notification.read ? "<span class='writer-notification-state is-read'><span></span>Read</span>" : "<span class='writer-notification-state is-new'><span></span>New</span>"}</td>
          <td data-label="Notification"><strong>${APP.escapeHtml(notification.title)}</strong></td>
          <td class="writer-notification-body" data-label="Details">${APP.escapeHtml(notification.body)}</td>
          <td data-label="Category"><span class="writer-notification-type">${APP.escapeHtml(notificationTypeLabel(notification.type))}</span></td>
          <td class="muted" data-label="Date">${APP.escapeHtml(createdAt.toLocaleDateString())}</td>
          <td class="muted" data-label="Time">${APP.escapeHtml(createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</td>
          <td data-label="Actions"><div class="writer-notification-actions">${href ? `<a href="${href}" data-open="${notification.id}" data-href="${href}"><button type="button">Open</button></a>` : ""}${notification.read ? "" : `<button class="secondary" data-read="${notification.id}">Mark read</button>`}</div></td>
        </tr>`;
      })
      .join("");

    for (const button of document.querySelectorAll("button[data-read]")) {
      button.onclick = async () => {
        await markRead(button.getAttribute("data-read"));
        await refresh();
      };
    }
    for (const link of document.querySelectorAll("a[data-open]")) {
      link.onclick = async (event) => {
        event.preventDefault();
        const href = link.getAttribute("data-href");
        try {
          await markRead(link.getAttribute("data-open"));
        } catch (_error) {}
        if (href) window.location.href = href;
      };
    }
  }

  async function refresh(silent) {
    if (!silent) {
      setMessage("");
      APP.ui.tableSkeleton("rows", { rows: 10, cols: 7 });
    }

    const data = await APP.apiFetch("/api/notifications");
    const notifications = data.notifications || [];
    const signature = notifications.map((notification) => `${notification.id}:${notification.read ? 1 : 0}`).join("|");
    const unread = notifications.filter((notification) => !notification.read).length;

    notificationTotal.textContent = String(notifications.length);
    notificationUnread.textContent = String(unread);
    notificationRead.textContent = String(notifications.length - unread);
    if (signature !== lastSignature) renderRows(notifications);

    if (data.unavailable) {
      renderEmpty("Notifications are not available for this workspace yet.");
      setMessage("Notifications will start appearing here after the notifications table is available.");
    } else if (!notifications.length) {
      setMessage("No notifications yet.");
    }

    if (silent && lastUnread != null && unread > lastUnread) {
      APP.ui?.toast?.(`${unread - lastUnread} new notification${unread - lastUnread === 1 ? "" : "s"}`, {
        kind: "success",
        ttlMs: 3200
      });
    }
    lastSignature = signature;
    lastUnread = unread;
  }

  try {
    await refresh();
  } catch (error) {
    renderEmpty("Could not load notifications right now.");
    setMessage(error.message || String(error));
  }

  if (window.__rwNotificationsPagePoll) clearInterval(window.__rwNotificationsPagePoll);
  window.__rwNotificationsPagePoll = setInterval(() => {
    refresh(true).catch(() => {});
  }, 3000);
})();
