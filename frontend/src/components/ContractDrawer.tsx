import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import {
  createContract,
  deleteContract,
  getLifecycle,
  getVendors,
  linkContractComponent,
  unlinkContractComponent,
  updateContract,
} from "../api/client";
import { faXmark } from "../icons";
import type { Component, ContractComponentRef, SupportContract } from "../types";
import Banner from "./Banner";
import ConfirmDialog from "./ConfirmDialog";
import DrawerShell from "./DrawerShell";
import SearchableSelect from "./SearchableSelect";
import { captionClass, inputClass } from "./ui";

/** Support contract create/edit drawer. `contract == null` is create mode
 *  (POST, all fields); otherwise edit mode (PATCH, only-changed keys).
 *  Linked-components editing (edit mode only) commits immediately via
 *  linkContractComponent/unlinkContractComponent — each response is the
 *  fresh contract, which refreshes the local components list independent of
 *  the Save button, mirroring SystemDrawer's membership editing. */
export default function ContractDrawer({
  contract,
  productId,
  onClose,
  onChanged,
}: {
  contract: SupportContract | null;
  productId: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [vendors, setVendors] = useState<string[]>([]);
  useEffect(() => {
    void getVendors().then((list) => setVendors(list.map((v) => v.name)));
  }, []);

  const [allComponents, setAllComponents] = useState<Component[]>([]);
  useEffect(() => {
    if (contract != null) void getLifecycle().then(setAllComponents);
  }, [contract]);

  const [name, setName] = useState(contract?.name ?? "");
  const [contractNo, setContractNo] = useState(contract?.contract_no ?? "");
  const [vendorName, setVendorName] = useState<string | null>(contract?.vendor_name ?? null);
  const [startDate, setStartDate] = useState(contract?.start_date ?? "");
  const [endDate, setEndDate] = useState(contract?.end_date ?? "");
  const [yearlyCost, setYearlyCost] = useState(
    contract?.yearly_cost != null ? String(contract.yearly_cost) : "",
  );
  const [noticePeriod, setNoticePeriod] = useState(
    contract?.notice_period_days != null ? String(contract.notice_period_days) : "",
  );
  const [notes, setNotes] = useState(contract?.notes ?? "");
  const [linkedComponents, setLinkedComponents] = useState<ContractComponentRef[]>(
    contract?.components ?? [],
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedYearlyCost = yearlyCost.trim() === "" ? null : Number(yearlyCost);
  const parsedNoticePeriod = noticePeriod.trim() === "" ? null : Number(noticePeriod);

  const componentLabel = (c: Component) => `${c.name} (${c.product_name ?? "?"})`;
  const linkedIds = new Set(linkedComponents.map((c) => c.id));
  const addableComponents = allComponents.filter((c) => !linkedIds.has(c.id));

  const save = async () => {
    setError(null);
    try {
      if (contract == null) {
        await createContract({
          name,
          product_id: productId,
          contract_no: contractNo || null,
          vendor_name: vendorName,
          start_date: startDate || null,
          end_date: endDate || null,
          yearly_cost: parsedYearlyCost,
          notice_period_days: parsedNoticePeriod,
          notes: notes || null,
        });
      } else {
        const changes: Parameters<typeof updateContract>[1] = {};
        if (name !== contract.name) changes.name = name;
        if (contractNo !== (contract.contract_no ?? "")) changes.contract_no = contractNo || null;
        if (vendorName !== (contract.vendor_name ?? null)) changes.vendor_name = vendorName;
        if (startDate !== (contract.start_date ?? "")) changes.start_date = startDate || null;
        if (endDate !== (contract.end_date ?? "")) changes.end_date = endDate || null;
        if (parsedYearlyCost !== contract.yearly_cost) changes.yearly_cost = parsedYearlyCost;
        if (parsedNoticePeriod !== contract.notice_period_days)
          changes.notice_period_days = parsedNoticePeriod;
        if (notes !== (contract.notes ?? "")) changes.notes = notes || null;
        await updateContract(contract.id, changes);
      }
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const linkComponent = async (componentId: number) => {
    if (!contract) return;
    setError(null);
    try {
      const fresh = await linkContractComponent(contract.id, componentId);
      setLinkedComponents(fresh.components);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link component");
    }
  };

  const unlinkComponent = async (componentId: number) => {
    if (!contract) return;
    setError(null);
    try {
      const fresh = await unlinkContractComponent(contract.id, componentId);
      setLinkedComponents(fresh.components);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unlink component");
    }
  };

  const remove = async () => {
    if (!contract) return;
    setError(null);
    try {
      await deleteContract(contract.id);
      await onChanged();
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(e instanceof Error ? e.message : "Delete blocked");
    }
  };

  return (
    <DrawerShell
      title={contract == null ? "New contract" : "Edit contract"}
      onClose={onClose}
      footer={{
        onDelete: contract == null ? undefined : () => setConfirmDelete(true),
        onCancel: onClose,
        onSave: () => void save(),
      }}
    >
      {error && (
        <div className="mb-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      <label className={captionClass}>Name</label>
      <input
        aria-label="Contract name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Contract number</label>
      <input
        aria-label="Contract number"
        value={contractNo}
        onChange={(e) => setContractNo(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Vendor</label>
      <div className="mb-3">
        <SearchableSelect
          ariaLabel="Vendor"
          value={vendorName}
          options={vendors}
          onChange={setVendorName}
          allowCreate
          placeholder="Vendor…"
        />
      </div>
      <label className={captionClass}>Start date</label>
      <input
        type="date"
        aria-label="Start date"
        value={startDate ?? ""}
        onChange={(e) => setStartDate(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>End date</label>
      <input
        type="date"
        aria-label="End date"
        value={endDate ?? ""}
        onChange={(e) => setEndDate(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Yearly cost</label>
      <input
        type="number"
        aria-label="Yearly cost"
        value={yearlyCost}
        onChange={(e) => setYearlyCost(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Notice period days</label>
      <input
        type="number"
        aria-label="Notice period days"
        value={noticePeriod}
        onChange={(e) => setNoticePeriod(e.target.value)}
        className={`${inputClass} mb-3`}
      />
      <label className={captionClass}>Notes</label>
      <textarea
        aria-label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className={`${inputClass} mb-4`}
      />

      {contract != null && (
        <>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Linked components</h3>
          <ul className="mb-2 flex flex-col gap-1.5">
            {linkedComponents.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm"
              >
                <span className="flex-1 truncate text-gray-800">
                  {c.name}
                  <span className="text-gray-400"> ({c.product_name ?? "?"})</span>
                </span>
                <button
                  aria-label={`Unlink ${c.name}`}
                  onClick={() => void unlinkComponent(c.id)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  <FontAwesomeIcon icon={faXmark} aria-hidden />
                </button>
              </li>
            ))}
            {linkedComponents.length === 0 && <li className="text-sm text-gray-400">None</li>}
          </ul>
          <div className="mb-4">
            <SearchableSelect
              ariaLabel="Link component"
              value={null}
              options={addableComponents.map(componentLabel)}
              onChange={(picked) => {
                if (!picked) return;
                const target = addableComponents.find((c) => componentLabel(c) === picked);
                if (target) void linkComponent(target.id);
              }}
              placeholder="Link component…"
            />
          </div>
        </>
      )}

      {confirmDelete && contract != null && (
        <ConfirmDialog
          title="Delete contract"
          message={`Delete “${contract.name}”?`}
          confirmLabel="Delete"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </DrawerShell>
  );
}
