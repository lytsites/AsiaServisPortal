// Освновной функционал для загрузки файлов

(function () {
  // In-memory state for current modal session
  const state = {
    files: [],     // {id, name}
    selectedId: null
  };

  function setStatus(msg, isError = false) {
    const el = $("#uploadStatus");
    el.text(msg || "");
    el.toggleClass("red-text", !!isError);
    el.toggleClass("green-text", !isError && !!msg);
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (m) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]);
    });
  }

  function updateNextBtn() {
    const btn = $("#nextBtn");
    const enabled = state.files.length > 0;

    // для Materialize (a.btn): работает класс disabled
    btn.toggleClass("disabled", !enabled);

    // на всякий случай (если позже станет <button>)
    btn.prop("disabled", !enabled);
    btn.attr("aria-disabled", String(!enabled));
  }

  function renderFileList() {
    const list = $("#fileList");
    list.empty();

    if (state.files.length === 0) {
      list.append(`<li class="collection-item grey-text text-darken-1">Пока нет файлов</li>`);
      updateNextBtn();
      return;
    }

    state.files.forEach(f => {
      const active = (f.id === state.selectedId) ? "active" : "";
      list.append(`
        <li class="collection-item ${active}" data-id="${f.id}">
          <i class="material-icons left">picture_as_pdf</i>
          ${escapeHtml(f.name)}
        </li>
      `);
    });

    updateNextBtn();
  }

  function selectFile(uploadId) {
    state.selectedId = uploadId;
    renderFileList();

    const file = state.files.find(x => x.id === uploadId);
    if (!file) return;

    $("#previewTitle").text(file.name);
    $("#previewHint").text("");

    $("#previewBody").html(`
      <iframe class="app-preview-embed" src="/viewer/${file.id}" title="preview"></iframe>
    `);
  }

  async function uploadOne(file) {
    const name = (file && file.name) ? file.name.toLowerCase() : "";
    if (!name.endsWith(".pdf")) {
      setStatus("Можно загружать только PDF.", true);
      return;
    }

    setStatus(`Загрузка: ${file.name} ...`, false);

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();

      if (!res.ok) {
        setStatus(data && data.detail ? data.detail : "Ошибка загрузки", true);
        return;
      }

      state.files.push({ id: data.id, name: data.name });
      updateNextBtn();

      // выбрать первый загруженный для предпросмотра
      if (!state.selectedId) {
        state.selectedId = data.id;
      }

      renderFileList();
      selectFile(state.selectedId);
      setStatus(`Загружено: ${file.name}`, false);
    } catch (err) {
      setStatus("Сетевая ошибка при загрузке.", true);
    }
  }

  function handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    (async () => {
      for (const f of fileList) {
        await uploadOne(f);
      }
    })();
  }

  function resetModalState() {
    state.files = [];
    state.selectedId = null;

    $("#previewTitle").text("Предпросмотр");
    $("#previewHint").text("Выберите файл слева — он появится здесь.");
    $("#previewBody").html(`
      <div class="app-preview-empty">
        <i class="material-icons">description</i>
        <div>Нет выбранного файла</div>
      </div>
    `);

    setStatus("", false);
    renderFileList();
    updateNextBtn();
  }

  async function commitUploads(ids) {
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data && data.detail ? data.detail : "Ошибка сохранения.", true);
        return false;
      }
      return true;
    } catch (err) {
      setStatus("Сетевая ошибка при сохранении.", true);
      return false;
    }
  }

  $(document).ready(function () {
    // init modal
    $(".modal").modal({
      onOpenStart: function () { resetModalState(); },
      onCloseEnd: function () { resetModalState(); }
    });

    // click on dropzone -> open dialog
    $("#dropzone").on("click", function () {
      $("#fileInput").trigger("click");
    });

    // choose files
    $("#fileInput").on("change", function () {
      handleFiles(this.files);
      $(this).val("");
    });

    // drag & drop
    const dz = document.getElementById("dropzone");
    if (dz) {
      dz.addEventListener("dragover", (e) => {
        e.preventDefault();
        dz.classList.add("dragover");
      });
      dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
      dz.addEventListener("drop", (e) => {
        e.preventDefault();
        dz.classList.remove("dragover");
        handleFiles(e.dataTransfer.files);
      });
    }

    // click in list -> select
    $("#fileList").on("click", ".collection-item", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const id = $(this).data("id");
      if (!id) return;
      selectFile(id);
    });

    // Далее:
    // - если 1 файл: commit -> открыть новое окно /file/{id}
    // - если 2+ файлов: commit -> открыть новое окно /history
    $("#nextBtn").on("click", async function(e){
      e.preventDefault();

      if ($(this).hasClass("disabled")) return;
      if (state.files.length === 0) return;

      const ids = state.files.map(f => f.id);
      const ok = await commitUploads(ids);
      if (!ok) return;

      if (state.files.length === 1) {
        window.open(`/file/${state.files[0].id}`, "_blank");
      } else {
        window.open(`/history`, "_blank");
      }
    });

    updateNextBtn();
  });
})();

// Сортировка таблиц (report.html и file.html)
$(document).ready(function () {
  const sortState = {}; // key -> asc | desc

  function parseValue(text, key){
    const t = (text || "").trim();

    if(key === "amount_in"){
      // "500,000.00" -> 500000.00
      const n = parseFloat(t.replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    }

    if(key === "iin_bin" || key === "kbk"){
      // как число, но безопасно
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? n : 0;
    }

    return t.toLowerCase();
  }

  // ВАЖНО: слушаем клики по THEAD (там th)
  $(document).on("click", "th.js-sort", function (e) {
    e.preventDefault();

    const th = $(this);
    const key = th.data("key");
    if(!key) return;

    const dir = sortState[key] === "asc" ? "desc" : "asc";
    sortState[key] = dir;

    // визуально
    $("th.js-sort").removeClass("sort-asc sort-desc");
    th.addClass(dir === "asc" ? "sort-asc" : "sort-desc");

    const colIndex = th.index();
    const table = th.closest('table');
    const tbody = table.find('tbody');
    const hasPeriods = tbody.find('.js-period-row').length > 0;

    if (hasPeriods) {
      // сортируем ВНУТРИ каждого периода отдельно
      tbody.find('.js-period-row').each(function () {
        const periodRow = $(this);
        const block = periodRow.nextUntil(".js-period-row", ".js-data-row");
        const rows = block.get();

        rows.sort(function (a, b) {
          const va = parseValue($(a).children().eq(colIndex).text(), key);
          const vb = parseValue($(b).children().eq(colIndex).text(), key);

          if (va < vb) return dir === "asc" ? -1 : 1;
          if (va > vb) return dir === "asc" ? 1 : -1;
          return 0;
        });

        // ВАЖНО: вставляем отсортированные строки в КОНЕЦ блока,
        // иначе порядок может переворачиваться
        const insertAfter = block.length ? block.last() : periodRow;
        rows.forEach(r => insertAfter.after(r));
      });
    } else {
      // нет периодов — сортируем все строки данных
      const rows = tbody.find('.js-data-row').get();

      rows.sort(function (a, b) {
        const va = parseValue($(a).children().eq(colIndex).text(), key);
        const vb = parseValue($(b).children().eq(colIndex).text(), key);

        if (va < vb) return dir === "asc" ? -1 : 1;
        if (va > vb) return dir === "asc" ? 1 : -1;
        return 0;
      });

      // Вставляем отсортированные строки обратно в tbody
      rows.forEach(r => tbody.append(r));
    }
  });
});
