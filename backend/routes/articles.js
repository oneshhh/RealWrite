const express = require("express");
const { authorizeRoles } = require("../middleware/authorize");
const { getSupabaseAdmin } = require("../utils/supabase");
const { buildArticleUniqueId } = require("../utils/uniqueId");
const { runAiCheck } = require("../services/aiCheck");
const { runPlagiarismCheck } = require("../services/plagiarismCheck");
const { notifyWriter } = require("../services/writerNotifications");
const { createNotification } = require("../services/notifications");
const { getManagerProjectIds, requireManagerProjectAccess } = require("../utils/projectAccess");

const router = express.Router();
const APP_NAME = process.env.APP_NAME || "Real Write";

async function nextArticleUniqueId(db, projectId) {
  const prefix = `ART-${projectId}-`;
  const { data, error } = await db
    .from("articles")
    .select("unique_id")
    .eq("project_id", projectId)
    .ilike("unique_id", `${prefix}%`);
  if (error) throw error;

  const maxSeq = (data || []).reduce((max, row) => {
    const raw = String(row.unique_id || "");
    if (!raw.startsWith(prefix)) return max;
    const seq = Number(raw.slice(prefix.length));
    return Number.isInteger(seq) && seq > max ? seq : max;
  }, 0);

  return buildArticleUniqueId(projectId, maxSeq + 1);
}

function isUniqueConstraintError(error) {
  const msg = String(error?.message || "");
  return error?.code === "23505" || msg.includes("articles_unique_id_key") || msg.includes("duplicate key value");
}

function monthRange(month) {
  const raw = String(month || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function ensureProjectAccess(db, projectId, user) {
  const { data: project, error } = await db.from("projects").select("*").eq("id", projectId).single();
  if (error) throw error;
  if (user.role === "manager") {
    await requireManagerProjectAccess(db, projectId, user.id);
  }
  return project;
}

function requestAccessError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function requireArticleAccess(db, articleId, user) {
  const { data: article, error } = await db.from("articles").select("*").eq("id", articleId).single();
  if (error) throw requestAccessError(error.message, 404);
  if (user.role === "writer" && article.writer_id !== user.id) throw requestAccessError("Forbidden", 403);
  if (user.role === "manager") await requireManagerProjectAccess(db, article.project_id, user.id);
  return article;
}

function normalizeReviewComment(raw, index) {
  const start = Number(raw?.anchor_start);
  const length = Number(raw?.anchor_length);
  const selectedText = String(raw?.selected_text || "").trim();
  const commentText = String(raw?.comment_text || "").trim();
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1) {
    throw requestAccessError(`Comment ${index + 1} has an invalid text selection.`);
  }
  if (!selectedText || !commentText) throw requestAccessError(`Comment ${index + 1} is incomplete.`);
  if (selectedText.length > 2000 || commentText.length > 4000) {
    throw requestAccessError(`Comment ${index + 1} is too long.`);
  }
  return {
    anchor_field: "long_description",
    anchor_start: start,
    anchor_length: length,
    selected_text: selectedText,
    prefix_text: String(raw?.prefix_text || "").slice(-120) || null,
    suffix_text: String(raw?.suffix_text || "").slice(0, 120) || null,
    comment_text: commentText,
    display_order: index + 1
  };
}

async function getRequestArticleContext(db, requestId, writerId, projectId) {
  const { data: recipient, error } = await db
    .from("project_request_recipients")
    .select("id,status,submitted_at,fulfilled_at,project_requests(id,project_id,title,status,send_scope,created_by,accepted_by,additional_payment)")
    .eq("request_id", requestId)
    .eq("writer_id", writerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!recipient?.project_requests) throw requestAccessError("Request not found.", 404);
  if (recipient.project_requests.project_id !== projectId) throw requestAccessError("Request does not belong to this project.");
  if (recipient.status !== "accepted") throw requestAccessError("Accept the request first.");

  const { data: article, error: articleErr } = await db
    .from("articles")
    .select("id,status,title,updated_at")
    .eq("writer_id", writerId)
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (articleErr) throw new Error(articleErr.message);

  return { recipient, request: recipient.project_requests, article };
}

async function getProjectManagerIds(db, projectId, createdBy) {
  const ids = new Set(createdBy ? [createdBy] : []);
  const { data, error } = await db
    .from("project_managers")
    .select("manager_id")
    .eq("project_id", projectId)
    .eq("status", "active");
  if (error && error.code !== "42P01") throw new Error(error.message);
  for (const row of data || []) {
    if (row.manager_id) ids.add(row.manager_id);
  }
  return Array.from(ids);
}

async function attachWriters(db, articles) {
  const rows = Array.isArray(articles) ? articles : [];
  const writerIds = Array.from(new Set(rows.map((article) => article?.writer_id).filter(Boolean)));
  if (!writerIds.length) return rows.map((article) => ({ ...article, writer: null }));

  const { data: users, error } = await db
    .from("users")
    .select("id,full_name,email,unique_id")
    .in("id", writerIds);
  if (error) throw new Error(error.message);

  const usersById = new Map((users || []).map((user) => [user.id, user]));
  return rows.map((article) => ({
    ...article,
    writer: usersById.get(article.writer_id) || null
  }));
}

async function notifyRequestManagers(db, { article, request, actor }) {
  const managerIds = await getProjectManagerIds(db, article.project_id, request.created_by);
  if (!managerIds.length) return;
  await Promise.all(
    managerIds
      .filter((userId) => userId && userId !== actor.id)
      .map((userId) =>
        createNotification({
          user_id: userId,
          type: "project_request_submission",
          title: "Request submission received",
          body: `${actor.full_name || "A writer"} submitted "${article.title}" for request "${request.title}".`,
          payload: { article_id: article.id, request_id: request.id, project_id: article.project_id }
        }).catch(() => null)
      )
  );
}

async function syncRequestArticleProgress(db, { request, writerId, articleId, articleStatus }) {
  const now = new Date().toISOString();
  const patch = { linked_article_id: articleId || null };
  if (articleStatus === "submitted") patch.submitted_at = now;
  if (articleStatus === "approved") patch.fulfilled_at = now;
  const { error } = await db
    .from("project_request_recipients")
    .update(patch)
    .eq("request_id", request.id)
    .eq("writer_id", writerId);
  if (error) throw new Error(error.message);

  if (articleStatus !== "approved") return;
  const { data: recipients, error: recipientsErr } = await db
    .from("project_request_recipients")
    .select("status,fulfilled_at")
    .eq("request_id", request.id);
  if (recipientsErr) throw new Error(recipientsErr.message);
  const accepted = (recipients || []).filter((row) => row.status === "accepted");
  const shouldClose = request.send_scope === "personal" || (accepted.length > 0 && accepted.every((row) => row.fulfilled_at));
  if (!shouldClose) return;
  await db
    .from("project_requests")
    .update({ status: "closed", closed_at: now, updated_at: now })
    .eq("id", request.id);
}

router.get("/", async (req, res) => {
  const db = getSupabaseAdmin();
  const user = req.auth.user;
  const status = req.query.status ? String(req.query.status).trim().toLowerCase() : null;
  const validStatuses = new Set(["draft", "submitted", "approved", "rejected", "rework"]);
  if (status && !validStatuses.has(status)) return res.status(400).json({ error: "Invalid article status" });
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const limit = limitRaw === undefined ? null : Number(limitRaw);
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
  const usePaging = Number.isFinite(limit) && limit > 0;
  const rangeFrom = usePaging ? Math.max(0, Number.isFinite(offset) ? offset : 0) : null;
  const rangeTo = usePaging ? rangeFrom + limit - 1 : null;

  if (user.role === "writer") {
    let q = db
      .from("articles")
      .select("*", { count: "exact" })
      .eq("writer_id", user.id);
    if (status) q = q.eq("status", status);
    q = q.order("updated_at", { ascending: false });
    if (usePaging) q = q.range(rangeFrom, rangeTo);
    const { data, error, count } = await q;
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ articles: data, total: count ?? null, limit: usePaging ? limit : null, offset: usePaging ? rangeFrom : null });
  }

  if (user.role === "manager") {
    // manager sees articles in their projects
    let projectIds;
    try {
      projectIds = await getManagerProjectIds(db, user.id);
    } catch (e) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    if (projectIds.length === 0) return res.json({ articles: [] });

    let q = db
      .from("articles")
      .select("*", { count: "exact" })
      .in("project_id", projectIds);
    if (status) q = q.eq("status", status);
    q = q.order("submitted_at", { ascending: false, nullsFirst: false });
    if (usePaging) q = q.range(rangeFrom, rangeTo);
    const { data, error, count } = await q;
    if (error) return res.status(400).json({ error: error.message });
    try {
      const articles = await attachWriters(db, data || []);
      return res.json({ articles, total: count ?? null, limit: usePaging ? limit : null, offset: usePaging ? rangeFrom : null });
    } catch (e) {
      return res.status(400).json({ error: e.message || String(e) });
    }
  }

  // admin
  let q = db.from("articles").select("*", { count: "exact" });
  if (status) q = q.eq("status", status);
  q = q.order("created_at", { ascending: false });
  if (usePaging) q = q.range(rangeFrom, rangeTo);
  const { data, error, count } = await q;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ articles: data, total: count ?? null, limit: usePaging ? limit : null, offset: usePaging ? rangeFrom : null });
});

router.get("/stats/me", authorizeRoles("writer"), async (req, res) => {
  const db = getSupabaseAdmin();
  const writerId = req.auth.user.id;

  const { data, error } = await db
    .from("articles")
    .select("status")
    .eq("writer_id", writerId);
  if (error) return res.status(400).json({ error: error.message });

  const counts = { approved: 0, rejected: 0, rework: 0, draft: 0, submitted: 0 };
  for (const row of data || []) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  return res.json({ counts });
});

router.get("/stats/monthly", authorizeRoles("writer", "manager", "admin"), async (req, res) => {
  const db = getSupabaseAdmin();
  const user = req.auth.user;
  const monthsRaw = req.query.months;
  const months = Math.max(1, Math.min(24, Number.isFinite(Number(monthsRaw)) ? Number(monthsRaw) : 12));

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0));
  const startIso = start.toISOString();

  const monthKey = (iso) => String(iso || "").slice(0, 7); // YYYY-MM
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 0, 0, 0));
    keys.push(d.toISOString().slice(0, 7));
  }
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));

  async function applyRows(rows) {
    for (const r of rows || []) {
      const k = monthKey(r.created_at);
      if (counts[k] !== undefined) counts[k] += 1;
    }
  }

  if (user.role === "writer") {
    const { data, error } = await db
      .from("articles")
      .select("id,created_at")
      .eq("writer_id", user.id)
      .gte("created_at", startIso)
      .order("created_at", { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    await applyRows(data);
    return res.json({ months: keys.map((k) => ({ month: k, count: counts[k] })) });
  }

  if (user.role === "manager") {
    let projectIds;
    try {
      projectIds = await getManagerProjectIds(db, user.id);
    } catch (e) {
      return res.status(400).json({ error: e.message || String(e) });
    }
    if (projectIds.length === 0) return res.json({ months: keys.map((k) => ({ month: k, count: 0 })) });

    const { data, error } = await db
      .from("articles")
      .select("id,created_at")
      .in("project_id", projectIds)
      .gte("created_at", startIso)
      .order("created_at", { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    await applyRows(data);
    return res.json({ months: keys.map((k) => ({ month: k, count: counts[k] })) });
  }

  // admin
  const { data, error } = await db
    .from("articles")
    .select("id,created_at")
    .gte("created_at", startIso)
    .order("created_at", { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  await applyRows(data);
  return res.json({ months: keys.map((k) => ({ month: k, count: counts[k] })) });
});

router.get("/project/:projectId/month", authorizeRoles("manager", "admin"), async (req, res) => {
  const { projectId } = req.params;
  const range = monthRange(req.query.month);
  if (!range) return res.status(400).json({ error: "month must be in YYYY-MM format" });

  const db = getSupabaseAdmin();
  let project;
  try {
    project = await ensureProjectAccess(db, projectId, req.auth.user);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || "Project not found" });
  }

  const { data: monthRows, error } = await db
    .from("articles")
    .select("id,unique_id,project_id,writer_id,title,status,created_at,updated_at,submitted_at,reviewed_at,manager_note")
    .eq("project_id", projectId)
    .gte("submitted_at", range.startIso)
    .lt("submitted_at", range.endIso)
    .order("submitted_at", { ascending: true, nullsFirst: false });
  if (error) return res.status(400).json({ error: error.message });

  const { data: allSubmitted, error: monthsErr } = await db
    .from("articles")
    .select("submitted_at")
    .eq("project_id", projectId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });
  if (monthsErr) return res.status(400).json({ error: monthsErr.message });

  const writerIds = Array.from(new Set((monthRows || []).map((a) => a.writer_id).filter(Boolean)));
  let usersById = new Map();
  if (writerIds.length) {
    const { data: users, error: usersErr } = await db
      .from("users")
      .select("id,full_name,email,unique_id")
      .in("id", writerIds);
    if (usersErr) return res.status(400).json({ error: usersErr.message });
    usersById = new Map((users || []).map((u) => [u.id, u]));
  }

  const stats = { approved: 0, rejected: 0, rework: 0, submitted: 0, total: 0 };
  const writerCounts = new Map();
  const articles = (monthRows || []).map((article) => {
    stats.total += 1;
    if (stats[article.status] !== undefined) stats[article.status] += 1;
    const writerNumber = (writerCounts.get(article.writer_id) || 0) + 1;
    writerCounts.set(article.writer_id, writerNumber);
    return {
      ...article,
      writer: usersById.get(article.writer_id) || null,
      writer_month_number: writerNumber
    };
  });

  const availableMonths = Array.from(
    new Set((allSubmitted || []).map((row) => String(row.submitted_at || "").slice(0, 7)).filter(Boolean))
  ).sort((a, b) => b.localeCompare(a));

  return res.json({ project, month: String(req.query.month), stats, articles, available_months: availableMonths });
});

router.get("/admin/list", authorizeRoles("admin"), async (req, res) => {
  const db = getSupabaseAdmin();
  const limitRaw = req.query.limit;
  const offsetRaw = req.query.offset;
  const limit = limitRaw === undefined ? 10 : Number(limitRaw);
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
  const usePaging = Number.isFinite(limit) && limit > 0;
  const rangeFrom = usePaging ? Math.max(0, Number.isFinite(offset) ? offset : 0) : 0;
  const rangeTo = usePaging ? rangeFrom + limit - 1 : null;

  const projectId = req.query.project_id ? String(req.query.project_id) : null;
  const q = String(req.query.q || "").trim();

  const baseSelect = "id,unique_id,project_id,writer_id,title,status,created_at,updated_at,submitted_at,reviewed_at";

  const buildQuery = () => {
    let query = db.from("articles").select(baseSelect, { count: "exact" }).order("created_at", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    return query;
  };

  // Search: do best-effort OR across `title` and `unique_id` (and writer_id) via two queries + union.
  if (q) {
    const [byTitle, byUid] = await Promise.all([
      buildQuery().ilike("title", `%${q}%`),
      buildQuery().ilike("unique_id", `%${q}%`)
    ]);
    const err = byTitle.error || byUid.error;
    if (err) return res.status(400).json({ error: err.message });
    const all = [...(byTitle.data || []), ...(byUid.data || [])];
    const dedup = Array.from(new Map(all.map((a) => [a.id, a])).values()).sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );
    const paged = usePaging ? dedup.slice(rangeFrom, rangeFrom + limit) : dedup;
    return res.json({ articles: paged, total: dedup.length, limit: usePaging ? limit : null, offset: usePaging ? rangeFrom : null });
  }

  let query = buildQuery();
  if (usePaging && rangeTo != null) query = query.range(rangeFrom, rangeTo);
  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ articles: data, total: count ?? null, limit: usePaging ? limit : null, offset: usePaging ? rangeFrom : null });
});

router.get("/admin/enriched", authorizeRoles("admin"), async (req, res) => {
  const db = getSupabaseAdmin();
  const out = await db
    .from("articles")
    .select("id,unique_id,project_id,writer_id,title,status,created_at,updated_at,submitted_at,reviewed_at", { count: "exact" });
  // We'll delegate filtering/paging to /admin/list to keep this endpoint simple.
  // This route is unused for now but kept for future expansion.
  if (out.error) return res.status(400).json({ error: out.error.message });
  return res.json({ articles: out.data, total: out.count ?? null });
});

router.get("/:id", authorizeRoles("writer", "manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const db = getSupabaseAdmin();
  const user = req.auth.user;

  const { data: article, error: getErr } = await db.from("articles").select("*").eq("id", id).single();
  if (getErr) return res.status(400).json({ error: getErr.message });

  if (user.role === "writer") {
    if (article.writer_id !== user.id) return res.status(403).json({ error: "Forbidden" });
    return res.json({ article });
  }

  if (user.role === "manager") {
    try {
      await requireManagerProjectAccess(db, article.project_id, user.id);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message || "Forbidden" });
    }
    try {
      const [articleWithWriter] = await attachWriters(db, [article]);
      return res.json({ article: articleWithWriter });
    } catch (e) {
      return res.status(400).json({ error: e.message || String(e) });
    }
  }

  // admin
  try {
    const [articleWithWriter] = await attachWriters(db, [article]);
    return res.json({ article: articleWithWriter });
  } catch (e) {
    return res.status(400).json({ error: e.message || String(e) });
  }
});

router.get("/:id/review-comments", authorizeRoles("writer", "manager", "admin"), async (req, res) => {
  const db = getSupabaseAdmin();
  try {
    await requireArticleAccess(db, req.params.id, req.auth.user);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || "Forbidden" });
  }

  let query = db
    .from("article_review_comments")
    .select("*")
    .eq("article_id", req.params.id)
    .order("review_round", { ascending: true })
    .order("display_order", { ascending: true });
  if (req.auth.user.role === "writer") query = query.neq("status", "resolved");
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ comments: data || [] });
});

router.patch("/:id/review-comments/:commentId", authorizeRoles("writer", "manager", "admin"), async (req, res) => {
  const db = getSupabaseAdmin();
  let article;
  try {
    article = await requireArticleAccess(db, req.params.id, req.auth.user);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || "Forbidden" });
  }

  const { data: existing, error: getErr } = await db
    .from("article_review_comments")
    .select("*")
    .eq("id", req.params.commentId)
    .eq("article_id", article.id)
    .single();
  if (getErr) return res.status(404).json({ error: "Comment not found." });

  const now = new Date().toISOString();
  const patch = { updated_at: now };
  if (req.auth.user.role === "writer") {
    if (article.writer_id !== req.auth.user.id) return res.status(403).json({ error: "Forbidden" });
    if (article.status !== "rework") return res.status(400).json({ error: "Comments can only be updated during rework." });
    const status = String(req.body?.status || "");
    if (!['open', 'addressed'].includes(status)) return res.status(400).json({ error: "Invalid comment status." });
    patch.status = status;
    patch.writer_addressed_at = status === "addressed" ? now : null;
  } else {
    if (req.body?.comment_text !== undefined) {
      const text = String(req.body.comment_text || "").trim();
      if (!text) return res.status(400).json({ error: "Comment cannot be empty." });
      patch.comment_text = text.slice(0, 4000);
    }
    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: "Invalid comment status." });
      patch.status = status;
      patch.resolved_at = status === "resolved" ? now : null;
    }
  }

  const { data, error } = await db
    .from("article_review_comments")
    .update(patch)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ comment: data });
});

router.delete("/:id", authorizeRoles("admin"), async (req, res) => {
  const { id } = req.params;
  const db = getSupabaseAdmin();

  // Delete related payment rows first (best-effort) to avoid FK constraints.
  await db.from("payments").delete().eq("article_id", id);

  const { error } = await db.from("articles").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

router.post("/", authorizeRoles("writer"), async (req, res) => {
  const { project_id, request_id, title, short_description, long_description, article_type, seo_tags } = req.body || {};
  if (!project_id) return res.status(400).json({ error: "project_id is required" });
  if (!title) return res.status(400).json({ error: "title is required" });

  const db = getSupabaseAdmin();
  // ensure writer is assigned to project
  const { data: assignment, error: aErr } = await db
    .from("project_writers")
    .select("id")
    .eq("project_id", project_id)
    .eq("writer_id", req.auth.user.id)
    .maybeSingle();
  if (aErr) return res.status(400).json({ error: aErr.message });
  if (!assignment) return res.status(403).json({ error: "Writer not assigned to project" });

  let requestContext = null;
  if (request_id) {
    try {
      requestContext = await getRequestArticleContext(db, String(request_id), req.auth.user.id, project_id);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message || String(e) });
    }
    if (requestContext.request.status === "closed" && !requestContext.article) {
      return res.status(400).json({ error: "This request is already closed." });
    }
    if (requestContext.article) {
      return res.status(409).json({ error: "You already created an article for this request." });
    }
  }

  const articlePayload = {
    project_id,
    writer_id: req.auth.user.id,
    request_id: requestContext?.request?.id || null,
    request_title: requestContext?.request?.title || null,
    title,
    short_description: short_description || null,
    long_description: long_description || null,
    article_type: article_type || "other",
    seo_tags: Array.isArray(seo_tags) ? seo_tags : null
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let unique_id;
    try {
      unique_id = await nextArticleUniqueId(db, project_id);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { data, error } = await db
      .from("articles")
      .insert([{ ...articlePayload, unique_id }])
      .select("*")
      .single();
    if (!error) return res.json({ article: data });
    if (!isUniqueConstraintError(error) || attempt === 2) return res.status(400).json({ error: error.message });
  }

  return res.status(409).json({ error: "Could not generate a unique article id. Please try again." });
});

router.patch("/:id", authorizeRoles("writer"), async (req, res) => {
  const { id } = req.params;
  const { title, short_description, long_description, article_type, seo_tags, review_comment_anchors } = req.body || {};

  const db = getSupabaseAdmin();
  const { data: article, error: getErr } = await db.from("articles").select("*").eq("id", id).single();
  if (getErr) return res.status(400).json({ error: getErr.message });
  if (article.writer_id !== req.auth.user.id) return res.status(403).json({ error: "Forbidden" });
  if (!["draft", "rework"].includes(article.status)) return res.status(400).json({ error: "Cannot edit in this status" });

  const patch = {
    title: title ?? article.title,
    short_description: short_description ?? article.short_description,
    long_description: long_description ?? article.long_description,
    article_type: article_type ?? article.article_type,
    seo_tags: seo_tags === undefined ? article.seo_tags : Array.isArray(seo_tags) ? seo_tags : null
  };

  const { data, error } = await db.from("articles").update(patch).eq("id", id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });

  if (Array.isArray(review_comment_anchors)) {
    const updates = review_comment_anchors.slice(0, 100).map(async (anchor) => {
      const commentId = String(anchor?.id || "");
      const start = Number(anchor?.anchor_start);
      const length = Number(anchor?.anchor_length);
      if (!commentId || !Number.isInteger(start) || start < 0 || !Number.isInteger(length) || length < 1) return;
      await db
        .from("article_review_comments")
        .update({
          anchor_start: start,
          anchor_length: length,
          selected_text: String(anchor?.selected_text || "").slice(0, 2000),
          prefix_text: String(anchor?.prefix_text || "").slice(-120) || null,
          suffix_text: String(anchor?.suffix_text || "").slice(0, 120) || null,
          updated_at: new Date().toISOString()
        })
        .eq("id", commentId)
        .eq("article_id", id)
        .neq("status", "resolved");
    });
    await Promise.all(updates);
  }
  return res.json({ article: data });
});

router.post("/:id/submit", authorizeRoles("writer"), async (req, res) => {
  const { id } = req.params;
  const db = getSupabaseAdmin();

  const { data: article, error: getErr } = await db.from("articles").select("*").eq("id", id).single();
  if (getErr) return res.status(400).json({ error: getErr.message });
  if (article.writer_id !== req.auth.user.id) return res.status(403).json({ error: "Forbidden" });
  if (!["draft", "rework"].includes(article.status)) return res.status(400).json({ error: "Cannot submit in this status" });

  const { data: project, error: pErr } = await db.from("projects").select("*").eq("id", article.project_id).single();
  if (pErr) return res.status(400).json({ error: pErr.message });

  const { data: updated, error: upErr } = await db
    .from("articles")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), manager_note: null })
    .eq("id", id)
    .select("*")
    .single();
  if (upErr) return res.status(400).json({ error: upErr.message });

  // Checks (best-effort for now)
  const patchChecks = {};
  if (project.ai_check_enabled) patchChecks.ai_score = await runAiCheck(updated);
  if (project.plagiarism_check_enabled) patchChecks.plagiarism_score = await runPlagiarismCheck(updated);
  if (Object.keys(patchChecks).length) {
    await db.from("articles").update(patchChecks).eq("id", id);
  }

  if (updated.request_id) {
    try {
      const requestContext = await getRequestArticleContext(db, updated.request_id, updated.writer_id, updated.project_id);
      await syncRequestArticleProgress(db, {
        request: requestContext.request,
        writerId: updated.writer_id,
        articleId: updated.id,
        articleStatus: "submitted"
      });
      await notifyRequestManagers(db, {
        article: updated,
        request: requestContext.request,
        actor: req.auth.user
      });
    } catch (_e) {}
  }

  return res.json({ article: { ...updated, ...patchChecks } });
});

router.post("/:id/review", authorizeRoles("manager"), async (req, res) => {
  const { id } = req.params;
  const { action, manager_note, comments } = req.body || {};
  if (!["approved", "rejected", "rework"].includes(action)) return res.status(400).json({ error: "Invalid action" });

  const db = getSupabaseAdmin();
  const { data: article, error: getErr } = await db.from("articles").select("*").eq("id", id).single();
  if (getErr) return res.status(400).json({ error: getErr.message });
  if (article.status !== "submitted") return res.status(400).json({ error: "Only submitted articles can be reviewed" });

  try {
    await requireManagerProjectAccess(db, article.project_id, req.auth.user.id);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message || "Forbidden" });
  }

  let insertedComments = [];
  let reviewRound = null;
  if (action === "rework") {
    if (comments !== undefined && !Array.isArray(comments)) return res.status(400).json({ error: "Comments must be a list." });
    if ((comments || []).length > 50) return res.status(400).json({ error: "A review can contain up to 50 comments." });
    let normalized;
    try {
      normalized = (comments || []).map(normalizeReviewComment);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    if (normalized.length) {
      const { data: lastRound, error: roundErr } = await db
        .from("article_review_comments")
        .select("review_round")
        .eq("article_id", id)
        .order("review_round", { ascending: false })
        .limit(1);
      if (roundErr) return res.status(400).json({ error: roundErr.message });
      reviewRound = Number(lastRound?.[0]?.review_round || 0) + 1;
      const { data: created, error: commentErr } = await db
        .from("article_review_comments")
        .insert(normalized.map((comment) => ({
          ...comment,
          article_id: id,
          manager_id: req.auth.user.id,
          review_round: reviewRound,
          status: "open"
        })))
        .select("*");
      if (commentErr) return res.status(400).json({ error: commentErr.message });
      insertedComments = created || [];
    }
  }

  const { data: updated, error } = await db
    .from("articles")
    .update({
      status: action,
      manager_note: action === "approved" ? null : manager_note || null,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (insertedComments.length) {
      await db.from("article_review_comments").delete().in("id", insertedComments.map((comment) => comment.id));
    }
    return res.status(400).json({ error: error.message });
  }

  const resolvedAt = new Date().toISOString();
  if (action === "rework") {
    let resolveQuery = db
      .from("article_review_comments")
      .update({ status: "resolved", resolved_at: resolvedAt, updated_at: resolvedAt })
      .eq("article_id", id)
      .neq("status", "resolved");
    if (reviewRound !== null) resolveQuery = resolveQuery.neq("review_round", reviewRound);
    await resolveQuery;
  } else if (action !== "rework") {
    await db
      .from("article_review_comments")
      .update({ status: "resolved", resolved_at: resolvedAt, updated_at: resolvedAt })
      .eq("article_id", id)
      .neq("status", "resolved");
  }

  let requestContext = null;
  if (updated.request_id) {
    try {
      requestContext = await getRequestArticleContext(db, updated.request_id, updated.writer_id, updated.project_id);
    } catch (_e) {}
  }

  // If approved, create a pending payment for this article (best-effort)
  if (action === "approved") {
    const { data: assignment } = await db
      .from("project_writers")
      .select("price_per_article")
      .eq("project_id", updated.project_id)
      .eq("writer_id", updated.writer_id)
      .maybeSingle();
    const baseAmount = Number(assignment?.price_per_article ?? 0);
    const extraAmount = Number(requestContext?.request?.additional_payment ?? 0);
    const amount =
      (Number.isFinite(baseAmount) ? baseAmount : 0) +
      (Number.isFinite(extraAmount) && extraAmount > 0 ? extraAmount : 0);
    await db
      .from("payments")
      .upsert(
        [
          {
            writer_id: updated.writer_id,
            project_id: updated.project_id,
            article_id: updated.id,
            request_id: updated.request_id || null,
            request_title: requestContext?.request?.title || updated.request_title || null,
            payment_reason: "article",
            amount,
            status: "pending"
          }
        ],
        { onConflict: "article_id" }
      );
    if (updated.request_id) {
      await db
        .from("payments")
        .delete()
        .eq("writer_id", updated.writer_id)
        .eq("request_id", updated.request_id)
        .eq("payment_reason", "request_bonus")
        .eq("status", "pending")
        .is("article_id", null);
    }
  }

  if (action === "approved" && requestContext) {
    try {
      await syncRequestArticleProgress(db, {
        request: requestContext.request,
        writerId: updated.writer_id,
        articleId: updated.id,
        articleStatus: "approved"
      });
    } catch (_e) {}
  }

  const { data: writer, error: writerErr } = await db
    .from("users")
    .select("id,email,full_name")
    .eq("id", updated.writer_id)
    .maybeSingle();
  if (writerErr) return res.status(400).json({ error: writerErr.message });

  // Notify writer
  const type =
    action === "approved" ? "article_approved" : action === "rejected" ? "article_rejected" : "article_rework";
  await notifyWriter({
    userId: updated.writer_id,
    email: writer?.email || null,
    type,
    title: `Article ${action}`,
    body:
      action === "approved"
        ? `Your article "${updated.title}" was approved.`
        : `Your article "${updated.title}" was marked as ${action}. ${insertedComments.length ? `${insertedComments.length} inline comment${insertedComments.length === 1 ? "" : "s"} added. ` : ""}${manager_note ? "Note: " + manager_note : ""}`.trim(),
    payload: { article_id: updated.id, project_id: updated.project_id },
    emailSubject: `${APP_NAME}: article ${action}`,
    emailText:
      action === "approved"
        ? `Your article "${updated.title}" was approved.`
        : `Your article "${updated.title}" was marked as ${action}.${insertedComments.length ? ` ${insertedComments.length} inline comment${insertedComments.length === 1 ? "" : "s"} added.` : ""}${manager_note ? ` Note: ${manager_note}` : ""}`
  });

  return res.json({ article: updated, comments: insertedComments });
});

// internal route (optional): re-run checks
router.post("/:id/checks", authorizeRoles("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const db = getSupabaseAdmin();
  const { data: article, error: getErr } = await db.from("articles").select("*").eq("id", id).single();
  if (getErr) return res.status(400).json({ error: getErr.message });
  const { data: project, error: pErr } = await db.from("projects").select("*").eq("id", article.project_id).single();
  if (pErr) return res.status(400).json({ error: pErr.message });
  if (req.auth.user.role === "manager") {
    try {
      await requireManagerProjectAccess(db, article.project_id, req.auth.user.id);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message || "Forbidden" });
    }
  }

  const patch = {};
  if (project.ai_check_enabled) patch.ai_score = await runAiCheck(article);
  if (project.plagiarism_check_enabled) patch.plagiarism_score = await runPlagiarismCheck(article);
  if (!Object.keys(patch).length) {
    // Nothing to do (checks disabled). Return current article as-is.
    return res.json({ article });
  }
  const { data: updated, error } = await db.from("articles").update(patch).eq("id", id).select("*").single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ article: updated });
});

module.exports = router;
