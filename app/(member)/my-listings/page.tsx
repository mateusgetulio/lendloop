"use client";
import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ToolCard, type Tool } from "@/components/tool-card";
import { ListingForm } from "@/components/listing-form";
import { Confirm, Empty, MoreResults, message } from "@/components/common";
export default function Page() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tools.mine,
    {},
    { initialNumItems: 20 },
  );
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Tool | "new" | null>(null),
    [deleting, setDeleting] = useState<Tool | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState("");
  async function confirm() {
    if (!deleting) return;
    setBusy(true);
    try {
      await remove({ toolId: deleting._id });
      setDeleting(null);
      setSaved("Listing deleted.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="title-row">
        <h1>My listings</h1>
        {!editing && (
          <button
            className="primary"
            onClick={() => {
              setEditing("new");
              setSaved("");
            }}
          >
            List a tool
          </button>
        )}
      </div>
      {saved && <p role="status">{saved}</p>}
      {editing ? (
        <ListingForm
          tool={editing === "new" ? undefined : editing}
          onSaved={() => {
            setEditing(null);
            setSaved("Listing saved.");
          }}
          onCancel={() => setEditing(null)}
        />
      ) : status === "LoadingFirstPage" ? (
        <p role="status">Loading listings...</p>
      ) : results.length === 0 ? (
        <Empty>
          You haven&apos;t listed anything yet. Use List a tool to share one.
        </Empty>
      ) : (
        <ul className="tool-grid">
          {results.map((t) => (
            <ToolCard key={t._id} tool={t}>
              <div className="actions">
                <button
                  onClick={() => {
                    setEditing(t);
                    setSaved("");
                  }}
                >
                  Edit listing
                </button>
                <button
                  onClick={() => {
                    setDeleting(t);
                    setError("");
                  }}
                >
                  Delete listing
                </button>
              </div>
            </ToolCard>
          ))}
        </ul>
      )}
      {!editing && <MoreResults status={status} loadMore={loadMore} />}
      {deleting && (
        <Confirm
          title="Delete listing"
          description={`Remove ${deleting.name}? Pending requests will be declined and future reservations cancelled. Loan history will remain.`}
          action={() => void confirm()}
          onClose={() => setDeleting(null)}
          busy={busy}
          error={error}
        />
      )}
    </>
  );
}
