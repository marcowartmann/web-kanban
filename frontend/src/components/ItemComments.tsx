import { useEffect, useState } from "react";
import { createComment, deleteComment, getComments, updateComment } from "../api/client";
import { useOptionalAuth } from "../auth/AuthContext";
import type { AuthUser, Comment } from "../types";

const box =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100";
const action =
  "text-xs font-medium text-gray-400 transition hover:text-gray-700";

function canModify(user: AuthUser | null, comment: Comment): boolean {
  return !!user && (user.role === "admin" || user.id === comment.author_id);
}

function Header({ comment }: { comment: Comment }) {
  return (
    <div className="text-xs text-gray-500">
      <span className="font-medium text-gray-700">{comment.author_name ?? "Unknown"}</span>
      <span className="text-gray-400"> · {new Date(comment.created_at).toLocaleString()}</span>
      {comment.updated_at && <span className="text-gray-400"> (edited)</span>}
    </div>
  );
}

export default function ItemComments({ itemId }: { itemId: number }) {
  const user = useOptionalAuth()?.user ?? null;
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () =>
    getComments(itemId)
      .then(setComments)
      .catch(() => setComments([]));

  useEffect(() => {
    let stale = false;
    setComments([]);
    getComments(itemId)
      .then((rows) => {
        if (!stale) setComments(rows);
      })
      .catch(() => {
        if (!stale) setComments([]);
      });
    return () => {
      stale = true;
    };
  }, [itemId]);

  const post = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await createComment(itemId, { body: draft.trim() });
      setDraft("");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const postReply = async (parentId: number) => {
    if (!replyDraft.trim() || busy) return;
    setBusy(true);
    try {
      await createComment(itemId, { body: replyDraft.trim(), parent_id: parentId });
      setReplyDraft("");
      setReplyTo(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: number) => {
    if (!editDraft.trim() || busy) return;
    setBusy(true);
    try {
      await updateComment(id, editDraft.trim());
      setEditingId(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (comment: Comment, replyCount: number) => {
    if (replyCount > 0 && !window.confirm("Delete this comment and its replies?")) return;
    await deleteComment(comment.id);
    await reload();
  };

  const topLevel = comments.filter((c) => c.parent_id === null);
  const repliesOf = (id: number) => comments.filter((c) => c.parent_id === id);

  const renderBody = (comment: Comment) =>
    editingId === comment.id ? (
      <div className="mt-1 flex flex-col gap-1.5">
        <textarea
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          rows={2}
          className={box}
        />
        <div className="flex gap-2">
          <button onClick={() => void saveEdit(comment.id)} className={action}>
            Save
          </button>
          <button onClick={() => setEditingId(null)} className={action}>
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <p className="whitespace-pre-wrap text-sm text-gray-800">{comment.body}</p>
    );

  const renderActions = (comment: Comment, isReply: boolean) => (
    <div className="mt-0.5 flex gap-3">
      {!isReply && user && (
        <button
          onClick={() => {
            setReplyTo(replyTo === comment.id ? null : comment.id);
            setReplyDraft("");
          }}
          className={action}
        >
          Reply
        </button>
      )}
      {canModify(user, comment) && editingId !== comment.id && (
        <>
          <button
            onClick={() => {
              setEditingId(comment.id);
              setEditDraft(comment.body);
            }}
            className={action}
          >
            Edit
          </button>
          <button
            onClick={() => void remove(comment, isReply ? 0 : repliesOf(comment.id).length)}
            className={`${action} hover:text-red-600`}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {user && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment…"
            rows={2}
            className={box}
          />
          <button
            onClick={() => void post()}
            disabled={!draft.trim() || busy}
            className="self-end rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            Post
          </button>
        </div>
      )}

      {topLevel.length === 0 && <p className="text-xs text-gray-400">No comments yet.</p>}

      <ul className="flex flex-col gap-3">
        {topLevel.map((comment) => (
          <li key={comment.id}>
            <Header comment={comment} />
            {renderBody(comment)}
            {renderActions(comment, false)}

            {repliesOf(comment.id).length > 0 && (
              <ul className="ml-4 mt-2 flex flex-col gap-2 border-l border-gray-200 pl-3">
                {repliesOf(comment.id).map((reply) => (
                  <li key={reply.id}>
                    <Header comment={reply} />
                    {renderBody(reply)}
                    {renderActions(reply, true)}
                  </li>
                ))}
              </ul>
            )}

            {replyTo === comment.id && (
              <div className="ml-4 mt-2 flex flex-col gap-1.5 border-l border-gray-200 pl-3">
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Write a reply…"
                  rows={2}
                  className={box}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void postReply(comment.id)}
                    disabled={!replyDraft.trim() || busy}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    Post reply
                  </button>
                  <button onClick={() => setReplyTo(null)} className={action}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
