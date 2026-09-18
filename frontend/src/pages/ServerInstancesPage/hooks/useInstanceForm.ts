/**
 * useInstanceForm -- the create/edit card and the delete dialog.
 *
 * The form is a card, not a dialog: opening it scrolls it into view and moves
 * focus into the first field, so Edit does not silently change something off
 * screen. Deleting opens one dialog with an explicit "also stop on the host"
 * checkbox, so Cancel always means "do nothing".
 */
import { useCallback, useRef, useState, type FormEvent } from "react";
import type { TFunction } from "i18next";

import type { ToastApi } from "../../../components/ui";
import { serverInstancesApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { ServerInstance, ServerInstanceCreate, SSHMachine } from "../../../types";
import {
  emptyForm,
  instanceToForm,
  quoteErrors,
  toUpdatePayload,
  type QuotedField,
} from "../instanceModel";

interface Args {
  machines: SSHMachine[];
  loadInstances: () => Promise<void>;
  toast: ToastApi;
  t: TFunction;
}

export function useInstanceForm({ machines, loadInstances, toast, t }: Args) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ServerInstanceCreate>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [clearServerPassword, setClearServerPassword] = useState(false);
  const [formError, setFormError] = useState("");
  const [invalidFields, setInvalidFields] = useState<QuotedField[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<ServerInstance | null>(null);
  const [purgeOnHost, setPurgeOnHost] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const formRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  /** Bring the form into view and put the caret in it, honouring reduced motion. */
  const revealForm = useCallback(() => {
    window.setTimeout(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      formRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      firstFieldRef.current?.focus();
    }, 50);
  }, []);

  const openCreate = useCallback(() => {
    setEditingId(null);
    // machines[0] is read at click time, so the hook needs the live array.
    setForm({ ...emptyForm, machine_id: machines[0]?.id ?? 0 });
    setClearServerPassword(false);
    setFormError("");
    setInvalidFields([]);
    setShowForm(true);
    revealForm();
  }, [machines, revealForm]);

  const openEdit = useCallback(
    (inst: ServerInstance) => {
      setEditingId(inst.id);
      setForm(instanceToForm(inst));
      setClearServerPassword(false);
      setFormError("");
      setInvalidFields([]);
      setShowForm(true);
      revealForm();
    },
    [revealForm],
  );

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setClearServerPassword(false);
    setFormError("");
    setInvalidFields([]);
  }, []);

  const setField = useCallback(
    <K extends keyof ServerInstanceCreate>(key: K, value: ServerInstanceCreate[K]) => {
      setForm(prev => ({ ...prev, [key]: value }));
      setInvalidFields(prev => prev.filter(f => f !== (key as string)));
    },
    [],
  );

  const submitForm = useCallback(
    async (evt: FormEvent) => {
      evt.preventDefault();
      // servers.py answers 422 on a double quote in these four fields.
      const bad = quoteErrors(form);
      if (bad.length > 0) {
        setInvalidFields(bad);
        setFormError(t("instances.form.quoteBlocked"));
        return;
      }
      setSaving(true);
      setFormError("");
      try {
        if (editingId === null) {
          await serverInstancesApi.create(form);
        } else {
          await serverInstancesApi.update(editingId, toUpdatePayload(form, clearServerPassword));
        }
        toast.success(t("instances.saved"));
        await loadInstances();
        closeForm();
      } catch (e) {
        setFormError(
          extractError(
            e,
            t(editingId === null ? "instances.errors.create" : "instances.errors.update"),
          ),
        );
      } finally {
        setSaving(false);
      }
    },
    [clearServerPassword, closeForm, editingId, form, loadInstances, t, toast],
  );

  const openDelete = useCallback((inst: ServerInstance) => {
    setDeleteTarget(inst);
    setPurgeOnHost(false);
    setDeleteError("");
  }, []);

  const closeDelete = useCallback(() => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await serverInstancesApi.delete(deleteTarget.id, purgeOnHost);
      await loadInstances();
      toast.success(t("instances.deleted", { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(extractError(e, t("instances.errors.delete")));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, loadInstances, purgeOnHost, t, toast]);

  return {
    showForm,
    editingId,
    form,
    saving,
    formError,
    invalidFields,
    clearServerPassword,
    setClearServerPassword,
    formRef,
    firstFieldRef,
    openCreate,
    openEdit,
    closeForm,
    setField,
    submitForm,
    deleteTarget,
    purgeOnHost,
    setPurgeOnHost,
    deleting,
    deleteError,
    openDelete,
    closeDelete,
    confirmDelete,
  };
}
