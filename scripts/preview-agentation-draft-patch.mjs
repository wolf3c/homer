// Deterministic local extension to fixed Agentation 3.1.2. No shared package edits.
const controller=`  // Homer: authoritative draft projection; native user events remain separate.
  const homerCandidate = useRef14(null);
  const [homerBusy, setHomerBusy] = useState11(false);
  const [homerError, setHomerError] = useState11("");
  const homerLive = useRef14({ pendingAnnotation, editingAnnotation });
  homerLive.current = { pendingAnnotation, editingAnnotation };
  useLayoutEffect10(() => {
    if (!onDraftController) return;
    const cancelPending = () => {
      homerCandidate.current = null;
      setHomerBusy(false); setHomerError("");
      setPendingAnnotation(null); setPendingExiting(false);
      setEditingAnnotation(null); setEditExiting(false);
      setEditingTargetElement(null); setEditingTargetElements([]);
      setRestoreEditPreview(false);
    };
    onDraftController({
      cancelPending,
      replaceAnnotations(next, options = {}) {
        const ids = new Set(next.map(note => note.id));
        for (const old of currentAnnotationsRef.current) {
          if (!ids.has(old.id)) { deletedIds.current.add(old.id); markerKeys.current.delete(old.id); animatedMarkers.current.delete(old.id); }
        }
        for (const id of ids) { deletedIds.current.delete(id); clearingIds.current.delete(id); pendingClearIds.current.delete(id); }
        setExitingMarkers(previous => new Set([...previous].filter(id => !ids.has(id))));
        currentAnnotationsRef.current = next;
        setAnnotations(next);
        saveAnnotations(pathname, next);
        const candidate = homerCandidate.current;
        if (options.settled && candidate) {
          homerCandidate.current = null;
          setHomerBusy(false); setHomerError(options.error || "");
          if (options.error) {
            if (candidate.kind === "add") { setPendingAnnotation({ ...candidate.pending, isSubmitted: false }); setPendingExiting(false); }
            else if (ids.has(candidate.note.id)) { setEditingAnnotation(candidate.note); setEditExiting(false); }
          } else if (candidate.kind === "add") setPendingExiting(true);
          else setEditExiting(true);
        } else {
          const editing = homerLive.current.editingAnnotation;
          if (editing && !ids.has(editing.id)) cancelPending();
        }
        if (!next.length) { setHoveredMarkerId(null); finishClearBatch(); }
      }
    });
    return () => { homerCandidate.current = null; onDraftController(null); };
  }, [onDraftController, pathname]);
`;
export const draftEdits=[
 ['  onActiveChange,\n  portalHost,','  onActiveChange,\n  onDraftController,\n  portalHost,'],
 ['  const fireWebhook = useCallback8(',controller+'  const fireWebhook = useCallback8('],
 ['      if (!pendingAnnotation || pendingAnnotation.isSubmitted) return;','      if (!pendingAnnotation || pendingAnnotation.isSubmitted || homerCandidate.current) return;'],
 ['      setAnnotations((prev) => [...prev, newAnnotation]);\n      setPendingAnnotation({ ...pendingAnnotation, isSubmitted: true });','      if (onDraftController) { homerCandidate.current = { kind: "add", pending: pendingAnnotation, note: newAnnotation }; setHomerBusy(true); setHomerError(""); }\n      setAnnotations((prev) => [...prev, newAnnotation]);\n      setPendingAnnotation({ ...pendingAnnotation, isSubmitted: true });'],
 ['      setPendingExiting(true);\n      window.getSelection()?.removeAllRanges();','      if (!onDraftController) setPendingExiting(true);\n      window.getSelection()?.removeAllRanges();'],
 ['      if (!editingAnnotation) return;\n      const updatedAnnotation = { ...editingAnnotation, comment: newComment };','      if (!editingAnnotation || homerCandidate.current || deletedIds.current.has(editingAnnotation.id) || !currentAnnotationsRef.current.some(note => note.id === editingAnnotation.id)) return;\n      const updatedAnnotation = { ...editingAnnotation, comment: newComment };\n      if (onDraftController) { homerCandidate.current = { kind: "update", note: updatedAnnotation }; setHomerBusy(true); setHomerError(""); }'],
 ['      setEditExiting(true);\n    },\n    [editingAnnotation, onAnnotationUpdate','      if (!onDraftController) setEditExiting(true);\n    },\n    [editingAnnotation, onAnnotationUpdate'],
 ['  const finishMarkerRemoval = useCallback8((id) => {','  const finishMarkerRemoval = useCallback8((id) => {\n    if (onDraftController && !deletedIds.current.has(id)) return;'],
 ['  const cancelAnnotation = useCallback8(() => {\n    setPendingExiting(true);','  const cancelAnnotation = useCallback8(() => {\n    if (homerCandidate.current) return;\n    setHomerError("");\n    setPendingExiting(true);'],
 ['  const cancelEditAnnotation = useCallback8(() => {\n    setRestoreEditPreview','  const cancelEditAnnotation = useCallback8(() => {\n    if (homerCandidate.current) return;\n    setHomerError("");\n    setRestoreEditPreview'],
 ['                    onSubmit: addAnnotation,','                    errorMessage: homerError,\n                    busy: homerBusy,\n                    onSubmit: addAnnotation,'],
 ['            onSubmit: updateAnnotation2,','            errorMessage: homerError,\n            busy: homerBusy,\n            onSubmit: updateAnnotation2,'],
 ['  variant = "popup"\n}, ref) {','  variant = "popup",\n  errorMessage,\n  busy = false\n}, ref) {'],
 ['        /* @__PURE__ */ jsx2(\n          "div",\n          {\n            "data-editor-actions": true,','        errorMessage && /* @__PURE__ */ jsx2("p", { role: "alert", style: { fontSize: 12, margin: "6px 0", color: "inherit" }, children: errorMessage }),\n        /* @__PURE__ */ jsx2(\n          "div",\n          {\n            "data-editor-actions": true,'],
 ['                  disabled: disabled || !text.trim() && !allowEmpty,','                  disabled: disabled || busy || !text.trim() && !allowEmpty,'],
 ['                  className: styles_module_default.deleteButton,\n                  onClick: onDelete,','                  className: styles_module_default.deleteButton,\n                  disabled: busy,\n                  onClick: onDelete,'],
 ['jsx2("button", { className: styles_module_default.cancel, onClick: onCancel, children: "Cancel" })','jsx2("button", { className: styles_module_default.cancel, disabled: busy, onClick: onCancel, children: "Cancel" })'],
 ['          disabled: !editing || exiting','          disabled: !editing || exiting || formProps?.busy'],
 ['    computedStyles\n  }, ref) {','    computedStyles,\n    errorMessage,\n    busy = false\n  }, ref) {'],
 ['            disabled: visibleAnimState === "exit"','            errorMessage,\n            busy,\n            disabled: busy || visibleAnimState === "exit"'],
 ['        id: Date.now().toString(),','        id: crypto.randomUUID(),',5],
];
export const draftTypeEdits=[
 ['type PageFeedbackToolbarCSSProps = {','type PageFeedbackToolbarCSSProps = {\n    /** Homer-local authoritative draft projection; does not emit user callbacks. */\n    onDraftController?: (controller: { replaceAnnotations(notes: Annotation[], options?: {settled?: boolean; error?: string}): void; cancelPending(): void } | null) => void;'],
];
