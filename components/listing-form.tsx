"use client";
import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { categories, conditions, label } from "@/lib/catalog";
import type { Tool } from "./tool-card";
import { message } from "./common";
type Values = {
  name: string;
  category: (typeof categories)[number];
  condition: (typeof conditions)[number];
  description: string;
};
export function ListingForm({
  tool,
  onSaved,
  onCancel,
}: {
  tool?: Tool;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(
    tool
      ? {
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
        }
      : {
          name: "",
          category: "power_tools",
          condition: "good",
          description: "",
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const create = useMutation(api.tools.create),
    edit = useMutation(api.tools.edit);
  function validate(key: "name" | "description") {
    const max = key === "name" ? 100 : 500;
    return !values[key].trim()
      ? `${label(key)} is required.`
      : values[key].trim().length > max
        ? `${label(key)} must be ${max} characters or fewer.`
        : "";
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = {
      name: validate("name"),
      description: validate("description"),
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      document.getElementById(found.name ? "name" : "description")?.focus();
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (tool) await edit({ toolId: tool._id, ...values });
      else await create(values);
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="form-stack">
      <h2>{tool ? "Edit listing" : "List a tool"}</h2>
      <div>
        <label htmlFor="name">Name</label>
        <input
          id="name"
          value={values.name}
          maxLength={100}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "name-error" : undefined}
          onBlur={() =>
            setErrors((e) => ({
              ...e,
              name: values.name ? validate("name") : "",
            }))
          }
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
        {errors.name && (
          <p id="name-error" className="field-error">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="category">Category</label>
        <select
          id="category"
          value={values.category}
          onChange={(e) =>
            setValues({
              ...values,
              category: e.target.value as Values["category"],
            })
          }
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="condition">Condition</label>
        <select
          id="condition"
          value={values.condition}
          onChange={(e) =>
            setValues({
              ...values,
              condition: e.target.value as Values["condition"],
            })
          }
        >
          {conditions.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="description">Short description</label>
        <textarea
          id="description"
          rows={4}
          maxLength={500}
          value={values.description}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={
            errors.description ? "description-error" : undefined
          }
          onBlur={() =>
            setErrors((e) => ({
              ...e,
              description: values.description ? validate("description") : "",
            }))
          }
          onChange={(e) =>
            setValues({ ...values, description: e.target.value })
          }
        />
        {errors.description && (
          <p id="description-error" className="field-error">
            {errors.description}
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving..." : tool ? "Save changes" : "Save listing"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
