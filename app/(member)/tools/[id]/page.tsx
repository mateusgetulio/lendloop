"use client";
import { use, type FormEvent, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge, Band, message } from "@/components/common";
import { formatRange, label, overlaps } from "@/lib/catalog";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params),
    tool = useQuery(api.tools.detail, { toolId: id }),
    settings = useQuery(api.clock.settings),
    request = useMutation(api.loans.request);
  const [startDate, setStart] = useState(""),
    [endDate, setEnd] = useState(""),
    [touched, setTouched] = useState<Record<string, boolean>>({}),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false);
  if (tool === undefined || !settings?.today)
    return <p role="status">Loading tool...</p>;
  if (tool === null)
    return (
      <>
        <Band
          eyebrow="Check another tool"
          title="Tool unavailable"
          lede="This listing is no longer available."
        />
        <Link className="button" href="/tools">
          Browse tools
        </Link>
      </>
    );
  const day = settings.today;
  const startError = !startDate
    ? "Choose a start date."
    : startDate < day
      ? "Start date must be today or later."
      : "";
  const endError = !endDate
    ? "Choose an end date."
    : endDate < startDate
      ? "End date must be on or after the start date."
      : "";
  const conflict =
    startDate &&
    endDate &&
    tool.busy.some((range) => overlaps(range, { startDate, endDate }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ start: true, end: true });
    setSaved(false);
    if (startError || endError || conflict) {
      document.getElementById(startError ? "startDate" : "endDate")?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request({ toolId: id as Id<"tools">, startDate, endDate });
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="band">
        <Link className="back-link" href="/tools">
          Back to tools
        </Link>
        <p className="eyebrow">{label(tool.category)}</p>
        <h1>{tool.name}</h1>
        <Badge>{tool.availability}</Badge>
        <p className="meta">Condition: {label(tool.condition)}</p>
      </div>
      <div className="detail-grid">
        <div>
          <h2 className="section-title">About this tool</h2>
          <p className="description">{tool.description}</p>
          <p className="owner">
            Lent by {tool.ownerName}{" "}
            {tool.trustedLender && (
              <span className="badge info">Trusted Lender</span>
            )}
          </p>
        </div>
        {tool.isOwner ? (
          <section className="panel">
            <h2>This is your listing</h2>
            <p>
              <Link href="/my-listings">Manage your listings</Link>
            </p>
          </section>
        ) : (
          <section className="panel">
            <h2>Request to borrow</h2>
            <h3>Busy dates</h3>
            {tool.busy.length ? (
              <ul className="busy-list">
                {tool.busy.map((r, i) => (
                  <li key={i}>
                    {formatRange(r.startDate, r.endDate)}
                    {r.endDate < day ? " (overdue, return date unknown)" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">No approved reservations.</p>
            )}
            {tool.hasMoreBusyRanges && (
              <p>
                Showing the first 50 reservations. Other dates may also be busy.
                Your request will be checked before it is saved.
              </p>
            )}
            <p className="note">
              Dates use {settings.timezone}. Both dates are included.
            </p>
            <form onSubmit={submit} noValidate className="form-stack">
              <div className="date-row">
                <div>
                  <label htmlFor="startDate">Start date</label>
                  <input
                    id="startDate"
                    type="date"
                    min={day}
                    value={startDate}
                    aria-invalid={Boolean(touched.start && startError)}
                    aria-describedby={
                      touched.start && startError ? "start-error" : undefined
                    }
                    onBlur={() =>
                      setTouched((t) => ({ ...t, start: Boolean(startDate) }))
                    }
                    onChange={(e) => {
                      setStart(e.target.value);
                      setSaved(false);
                      setError("");
                    }}
                  />
                  {touched.start && startError && (
                    <p id="start-error" className="field-error">
                      {startError}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="endDate">End date</label>
                  <input
                    id="endDate"
                    type="date"
                    min={startDate || day}
                    value={endDate}
                    aria-invalid={Boolean(touched.end && endError)}
                    aria-describedby={
                      touched.end && endError ? "end-error" : undefined
                    }
                    onBlur={() =>
                      setTouched((t) => ({ ...t, end: Boolean(endDate) }))
                    }
                    onChange={(e) => {
                      setEnd(e.target.value);
                      setSaved(false);
                      setError("");
                    }}
                  />
                  {touched.end && endError && (
                    <p id="end-error" className="field-error">
                      {endError}
                    </p>
                  )}
                </div>
              </div>
              {conflict && (
                <p role="alert">
                  These dates overlap an approved loan. Choose different dates.
                </p>
              )}
              {error && <p role="alert">{error}</p>}
              {saved && (
                <p role="status">
                  Request sent.{" "}
                  <Link href="/my-requests">View your requests</Link>.
                </p>
              )}
              <button className="primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Request to borrow"}
              </button>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
