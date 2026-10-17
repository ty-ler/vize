;;; emacs-native-config.el --- Real Eglot project settings -*- lexical-binding: t; -*-

(require 'ert)
(require 'eglot)
(require 'json)
(require 'seq)

(load-file (expand-file-name "editors/emacs/vize.el" (getenv "VIZE_EMACS_REPOSITORY")))

(defvar vize-real--cases nil)

(defun vize-real--entries ()
  "Read complete packets retained by the transparent real-server tap."
  (let ((file (getenv "VIZE_CONFORMANCE_TRANSCRIPT")) entries)
    (when (file-exists-p file)
      (with-temp-buffer
        (insert-file-contents file)
        (dolist (line (split-string (buffer-string) "\n" t))
          (condition-case nil
              (push (json-parse-string line :object-type 'plist :array-type 'array
                                       :null-object nil :false-object :json-false)
                    entries)
            (json-parse-error nil)))))
    (nreverse entries)))

(defun vize-real--wait (label predicate)
  "Allow the real client to process input until PREDICATE satisfies LABEL."
  (let ((deadline (+ (float-time) 30)) found)
    (while (and (not (setq found (funcall predicate))) (< (float-time) deadline))
      (accept-process-output nil 0.05))
    (unless found (ert-fail (format "Timed out waiting for %s" label)))
    found))

(defun vize-real--open (name)
  "Open NAME through the packaged Vue mode and ordinary Eglot startup."
  (let ((buffer (find-file-noselect
                 (expand-file-name name (getenv "VIZE_EMACS_WORKSPACE")))))
    (with-current-buffer buffer
      (should (eq major-mode 'vize-vue-mode))
      (eglot-ensure)
      ;; `eglot-ensure' starts after the next editor command, also in batch.
      (run-hooks 'post-command-hook)
      (vize-real--wait "Eglot management" #'eglot-managed-p))
    buffer))

(defun vize-real--diagnostics (buffer deprecated &optional version)
  "Wait for BUFFER's complete native publication and DEPRECATED rule state."
  (let ((uri (with-current-buffer buffer
               (plist-get (eglot--TextDocumentIdentifier) :uri))))
    (vize-real--wait
     (format "%s diagnostics (deprecated=%s)" (buffer-name buffer) deprecated)
     (lambda ()
       (let* ((entry
               (seq-find
                (lambda (entry)
                  (let ((message (plist-get entry :msg)))
                    (and (equal (plist-get entry :dir) "s2c")
                         (equal (plist-get message :method) "textDocument/publishDiagnostics")
                         (equal (plist-get (plist-get message :params) :uri) uri))))
                (reverse (vize-real--entries))))
              (params (plist-get (plist-get entry :msg) :params))
              (matched
               (seq-some (lambda (diagnostic)
                           (equal (plist-get diagnostic :code)
                                  "vue/no-deprecated-v-bind-sync"))
                         (plist-get params :diagnostics))))
         (and params (>= (or (plist-get params :version) 0) (or version 0))
              (eq (not (null matched)) deprecated)
              params))))))

(defun vize-real--hover (buffer)
  "Request native hover through the real Eglot JSON-RPC connection."
  (with-current-buffer buffer
    (jsonrpc-request (eglot-current-server) :textDocument/hover
                     `(:textDocument ,(eglot--TextDocumentIdentifier)
                       :position (:line 1 :character 8))
                     :timeout 15)))

(defun vize-real--record (name legacy modern hover)
  "Keep complete case observations in addition to the unmodified wire packets."
  (push (list :phase name :legacy legacy :modern modern :hover hover) vize-real--cases)
  (with-temp-file (getenv "VIZE_EMACS_CASES")
    (insert (json-serialize (vconcat (reverse vize-real--cases))
                            :null-object nil :false-object :json-false))))

(ert-deftest vize-eglot-real-vite-and-reference-ownership ()
  (let ((eglot-sync-connect t)
        (eglot-connect-timeout 60)
        (eglot-autoshutdown t)
        (eglot-send-changes-idle-time 0.05)
        (vize-eglot-profile nil)
        legacy modern server)
    (unwind-protect
        (progn
          (vize-setup-eglot)
          (setq legacy (vize-real--open "Legacy.vue"))
          (setq server (with-current-buffer legacy (eglot-current-server)))
          (setq modern (vize-real--open "Modern.vue"))
          (should (eq server (with-current-buffer modern (eglot-current-server))))
          (let ((legacy-packet (vize-real--diagnostics legacy nil))
                (modern-packet (vize-real--diagnostics modern t))
                (hover (vize-real--hover modern)))
            (should-not hover)
            (vize-real--record "initial-reference-targets-and-vite-hover"
                               legacy-packet modern-packet hover)))
      (when server (ignore-errors (eglot-shutdown server nil 10)))
      (dolist (buffer (list legacy modern))
        (when (buffer-live-p buffer)
          (with-current-buffer buffer (set-buffer-modified-p nil))
          (kill-buffer buffer))))))

;;; emacs-native-config.el ends here
