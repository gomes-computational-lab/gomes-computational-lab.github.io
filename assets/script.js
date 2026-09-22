// assets/script.js — Universal JSON loader for all pages
document.addEventListener("DOMContentLoaded", () => {
    const page = (window.location.pathname.split("/").pop() || "index.html").toLowerCase();

    /**
     * Utilities
     */
    const qs = (id) => document.getElementById(id);
    function el(tag, attrs = {}, children = []) {
        const element = document.createElement(tag);
        for (let key in attrs) {
            if (key === "html") element.innerHTML = attrs[key];
            else element.setAttribute(key, attrs[key]);
        }
        (Array.isArray(children) ? children : [children]).forEach(child => {
            if (child == null) return;
            if (typeof child === "string") element.appendChild(document.createTextNode(child));
            else element.appendChild(child);
        });
        return element;
    }
    async function fetchJSON(path) {
        try {
            const res = await fetch(path, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error(`Error loading ${path}:`, err);
            return null;
        }
    }
    function searchFilter(arr, query, keys) {
        const q = (query || "").toLowerCase();
        if (!q) return arr;
        return arr.filter(item => keys.some(k => (item[k] || "").toString().toLowerCase().includes(q)));
    }
    function setLoading(id) { const n = qs(id); if (n) n.innerHTML = `<p style="color:#666;font-style:italic;">Loading…</p>`; }
    function setEmpty(id)   { const n = qs(id); if (n) n.innerHTML = `<p style="color:#999;font-style:italic;">No content found.</p>`; }

    /**
     * Home (index.html)
     */
    async function loadHome() {
        setLoading("updates");
        setLoading("homePublications");
        const [updates, publicationData] = await Promise.all([
            fetchJSON("data/updates.json"),
            fetchJSON("data/publications.json"),
        ]);

        const publicationsContainer = qs("homePublications");
        const peerReviewed = Array.isArray(publicationData?.peer_reviewed)
            ? [...publicationData.peer_reviewed]
                .sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0))
                .slice(0, 4)
            : [];

        if (!publicationsContainer || !peerReviewed.length) {
            setEmpty("homePublications");
        } else {
            publicationsContainer.innerHTML = "";
            peerReviewed.forEach(publication => {
                const title = publication.title || "Untitled publication";
                const href = publication.link || (publication.doi ? `https://doi.org/${publication.doi}` : "");
                const titleContent = href
                    ? el("a", { href, target: "_blank", rel: "noopener" }, [title])
                    : title;
                const details = el("div", {}, [
                    el("h3", {}, [titleContent]),
                ]);

                if (publication.authors) {
                    details.appendChild(el("p", { class: "home-publication-authors" }, [publication.authors]));
                }
                if (publication.venue) {
                    details.appendChild(el("p", { class: "home-publication-venue" }, [publication.venue]));
                }

                publicationsContainer.appendChild(el("article", { class: "home-publication" }, [
                    el("div", { class: "home-publication-year" }, [String(publication.year || "—")]),
                    details,
                ]));
            });
        }

        if (!updates || !updates.length) return setEmpty("updates");

        const searchEl = qs("uSearch");
        function render() {
            const filtered = searchFilter(updates, searchEl?.value, ["title", "detail", "date"])
                .sort((a, b) => b.date.localeCompare(a.date));
            const cont = qs("updates");
            cont.innerHTML = "";
            filtered.forEach(u => {
                cont.appendChild(el("article", { class: "update" }, [
                    el("time", { class: "small muted", datetime: u.date || "" }, [u.date || ""]),
                    el("div", {}, [el("strong", {}, [u.title || "Untitled update"])]),
                    el("div", {}, [u.detail || ""])
                ]));
            });
            if (!filtered.length) setEmpty("updates");
        }
        if (searchEl) searchEl.addEventListener("input", render);
        render();
    }

    /**
     * Publications (publications.html)
     */
    async function loadPublications() {
        ["peer","posters","regional"].forEach(setLoading);
        const data = await fetchJSON("data/publications.json");
        if (!data) return ["peer","posters","regional"].forEach(setEmpty);

        const searchEl = qs("pSearch");
        const cite = (item) => {
            const parts = [];
            if (item.authors) parts.push(item.authors + ". ");
            if (item.title) parts.push("<strong>" + item.title + "</strong>. ");
            if (item.venue) parts.push(item.venue + ". ");
            if (item.year) parts.push(item.year);
            const link = item.doi ? ` <a href="https://doi.org/${item.doi}" target="_blank">doi:${item.doi}</a>` :
                         (item.link ? ` <a target="_blank" href="${item.link}">link</a>` : "");
            return `<div class="citation">${parts.join("")}<div class="meta">${link}</div></div>`;
        };
        function render() {
            const q = searchEl?.value;
            const peer = searchFilter(data.peer_reviewed || [], q, ["title","authors","venue","year"]).sort((a,b)=>b.year-a.year);
            const posters = searchFilter(data.posters_and_abstracts || [], q, ["title","authors","venue","year"]).sort((a,b)=>b.year-a.year);
            const regional = searchFilter(data.regional_ug || [], q, ["title","authors","venue","year"]).sort((a,b)=>b.year-a.year);
            qs("peer").innerHTML = peer.length ? peer.map(cite).join("") : `<p>No content found.</p>`;
            qs("posters").innerHTML = posters.length ? posters.map(cite).join("") : `<p>No content found.</p>`;
            qs("regional").innerHTML = regional.length ? regional.map(cite).join("") : `<p>No content found.</p>`;
        }
        if (searchEl) searchEl.addEventListener("input", render);
        render();
    }

async function loadGrants() {
  const bodyId = "grants";
  const searchId = "gSearch";

  // loading state
  const tb = document.getElementById(bodyId);
  if (tb) tb.innerHTML = `<tr><td colspan="5" style="color:#666;font-style:italic;">Loading…</td></tr>`;

  const data = await fetchJSON("data/grants.json");
  if (!data) {
    if (tb) tb.innerHTML = `<tr><td colspan="5" style="color:#999;font-style:italic;">No content found.</td></tr>`;
    return;
  }

  const searchEl = document.getElementById(searchId);

  function render() {
    const q = (searchEl?.value || "").toLowerCase().trim();
    const filtered = q
      ? data.filter(g =>
          ["title","role","years","notes","amount"]
            .some(k => (g[k] || "").toString().toLowerCase().includes(q))
        )
      : data;

    if (!tb) return;
    tb.innerHTML = "";
    if (!filtered.length) {
      tb.innerHTML = `<tr><td colspan="5" style="color:#999;font-style:italic;">No content found.</td></tr>`;
      return;
    }
    filtered.forEach(g => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${g.years || ""}</td>
        <td>${g.title || ""}</td>
        <td>${g.role || ""}</td>
        <td>${g.amount || ""}</td>
        <td>${g.notes || ""}</td>
      `;
      tb.appendChild(tr);
    });
  }

  if (searchEl) searchEl.addEventListener("input", render);
  render();
}

async function loadProjects() {
  const healthcareGrid = document.getElementById("healthcareProjectsGrid");
  const collaborationGrid = document.getElementById("collaborationProjectsGrid");
  const previousGrid = document.getElementById("previousProjectsGrid");
  const pastStudents = [...document.querySelectorAll(".past-student")];
  const pastStudentsEmpty = document.getElementById("pastStudentsEmpty");
  const grids = [healthcareGrid, collaborationGrid, previousGrid].filter(Boolean);
  grids.forEach(grid => {
    grid.innerHTML = `<div class="card"><p style="color:#666;font-style:italic;">Loading…</p></div>`;
  });

  const data = await fetchJSON("data/research.json");
  if (!healthcareGrid || !collaborationGrid || !previousGrid) return;
  if (!data || !Array.isArray(data) || data.length === 0) {
    grids.forEach(grid => {
      grid.innerHTML = `<div class="card"><p style="color:#999;font-style:italic;">No content found.</p></div>`;
    });
    return;
  }

  const searchEl = document.getElementById("projSearch");
  let initialProjectAnchorHandled = false;

  function renderGrid(grid, items, emptyMessage) {
    grid.innerHTML = "";
    if (!items.length) {
      grid.innerHTML = `<div class="card"><p style="color:#999;font-style:italic;">${emptyMessage}</p></div>`;
      return;
    }

    items.forEach(p => {
      const tools = Array.isArray(p.tools) ? p.tools : [];
      const collaborators = Array.isArray(p.collaborators) ? p.collaborators : [];
      const students = Array.isArray(p.students) ? p.students : [];

      const card = document.createElement("article");
      card.className = "card project-card";
      if (p.anchor) card.id = p.anchor;

      if (p.image) {
        const thumb = document.createElement("div");
        thumb.className = "thumb";
        const img = document.createElement("img");
        img.src = p.image;
        img.alt = p.title || "Project image";
        img.loading = "lazy";
        img.onerror = () => {
          img.remove();
          thumb.classList.add("thumb-placeholder");
        };
        thumb.appendChild(img);
        card.appendChild(thumb);
      }

      if (p.label) {
        card.appendChild(el("div", { class: "project-label" }, [p.label]));
      }

      card.appendChild(el("h3", {}, [p.title || "Untitled Project"]));

      if (p.project_lead) {
        card.appendChild(el("div", { class: "project-detail-block project-lead" }, [
          el("div", { class: "section-title" }, ["Project Lead"]),
          el("p", {}, [p.project_lead]),
        ]));
      }

      if (p.abstract) {
        card.appendChild(el("div", { class: "section-title" }, ["Abstract"]));
        card.appendChild(el("p", {}, [p.abstract]));
      }

      if (tools.length) {
        card.appendChild(el("div", { class: "section-title" }, ["Tools used"]));
        const meta = document.createElement("div");
        meta.className = "project-meta";
        tools.forEach(t => meta.appendChild(el("span", { class: "badge" }, [t])));
        card.appendChild(meta);
      }

      if (collaborators.length) {
        const collaboratorBlock = el("div", { class: "project-detail-block project-collaborators" }, [
          el("div", { class: "section-title" }, ["Collaborators"]),
        ]);
        const collaboratorList = el("ul", { class: "project-detail-list" });
        collaborators.forEach(collaborator => collaboratorList.appendChild(el("li", {}, [collaborator])));
        collaboratorBlock.appendChild(collaboratorList);
        card.appendChild(collaboratorBlock);
      }

      if (students.length) {
        const studentBlock = el("div", { class: "project-students" }, [
          el("div", { class: "section-title" }, ["Current Students"]),
        ]);
        const studentList = el("ul", { class: "project-student-list" });
        students.forEach(student => studentList.appendChild(el("li", {}, [student])));
        studentBlock.appendChild(studentList);
        card.appendChild(studentBlock);
      }

      grid.appendChild(card);
    });
  }

  function render() {
    const q = (searchEl?.value || "").toLowerCase().trim();
    const items = q
      ? data.filter(p =>
          (p.title || "").toLowerCase().includes(q) ||
          (p.abstract || "").toLowerCase().includes(q) ||
          (p.project_lead || "").toLowerCase().includes(q) ||
          (Array.isArray(p.tools) ? p.tools : []).join(" ").toLowerCase().includes(q) ||
          (Array.isArray(p.collaborators) ? p.collaborators : []).join(" ").toLowerCase().includes(q) ||
          (Array.isArray(p.students) ? p.students : []).join(" ").toLowerCase().includes(q)
        )
      : data;

    const current = items.filter(p => (p.status || "").toLowerCase() === "current");
    const healthcare = current.filter(p => (p.group || "healthcare").toLowerCase() === "healthcare");
    const collaborations = current.filter(p => (p.group || "").toLowerCase() === "collaboration");
    const previous = items.filter(p => (p.status || "").toLowerCase() === "previous");

    renderGrid(healthcareGrid, healthcare, q ? "No matching healthcare research." : "No healthcare research found.");
    renderGrid(collaborationGrid, collaborations, q ? "No matching interdisciplinary collaborations." : "No interdisciplinary collaborations found.");
    renderGrid(previousGrid, previous, q ? "No matching previous research." : "No previous research projects are currently listed.");

    let visiblePastStudents = 0;
    pastStudents.forEach(student => {
      const matches = !q || (student.dataset.name || student.textContent || "").toLowerCase().includes(q);
      student.hidden = !matches;
      if (matches) visiblePastStudents += 1;
    });
    if (pastStudentsEmpty) pastStudentsEmpty.hidden = visiblePastStudents > 0;

    if (!initialProjectAnchorHandled && window.location.hash) {
      const anchor = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (anchor && anchor.classList.contains("project-card")) {
        initialProjectAnchorHandled = true;
        requestAnimationFrame(() => anchor.scrollIntoView({ block: "start" }));
      }
    }
  }

  searchEl?.addEventListener("input", render);
  render();
}

async function loadMedia() {
  const wrap = document.getElementById("media");
  if (wrap) wrap.innerHTML = `<div class="card"><p style="color:#666;font-style:italic;">Loading…</p></div>`;

  const data = await fetchJSON("data/media.json");
  if (!wrap) return;
  if (!data || !Array.isArray(data) || data.length === 0) {
    wrap.innerHTML = `<div class="card"><p style="color:#999;font-style:italic;">No content found.</p></div>`;
    return;
  }

  const parseDate = (s) => {
    if (!s) return null;
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t);
  };

  const sorted = [...data].sort((a, b) => {
    const da = parseDate(a.date), db = parseDate(b.date);
    if (da && db) return db - da;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return 0;
  });

  const searchEl = document.getElementById("mSearch");

  function render() {
    const q = (searchEl?.value || "").toLowerCase().trim();
    const items = q
      ? sorted.filter(i =>
          (i.title || "").toLowerCase().includes(q) ||
          (i.outlet || "").toLowerCase().includes(q) ||
          (i.date || "").toLowerCase().includes(q)
        )
      : sorted;

    wrap.innerHTML = "";
    if (!items.length) {
      wrap.innerHTML = `<div class="card"><p style="color:#999;font-style:italic;">No matching results.</p></div>`;
      return;
    }

    items.forEach(i => {
      const card = document.createElement("article");
      card.className = "card media-item"; // default layout has space for a thumb

      const body = document.createElement("div");
      body.className = "media-body";

      const title = document.createElement("h3");
      title.innerHTML = i.title || "Untitled";

      const meta = document.createElement("div");
      meta.className = "small muted";
      meta.textContent = [i.outlet || "", i.date || ""].filter(Boolean).join(" • ");

      const link = document.createElement("a");
      link.href = i.url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "btn ghost";
      link.textContent = "Read";

      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(link);

      let thumbAdded = false;
      if (i.image) {
        const figure = document.createElement("div");
        figure.className = "thumb";
        const img = document.createElement("img");
        img.src = i.image;
        img.alt = i.title || "Media thumbnail";
        img.onload = () => { /* good */ };
        img.onerror = () => { figure.remove(); card.classList.add("no-thumb"); };
        figure.appendChild(img);
        card.appendChild(figure);
        thumbAdded = true;
      }

      if (!thumbAdded) {
        // no image provided; render as text-only layout
        card.classList.add("no-thumb");
      }

      card.appendChild(body);
      wrap.appendChild(card);
    });
  }

  searchEl?.addEventListener("input", render);
  render();
}

async function loadTeaching(){
  try {
    const res = await fetch('data/courses.json');
    const data = await res.json();

    const term = data.current_semester.term || '';
    document.getElementById('currentTerm').textContent = `Current Semester — ${term}`;

    const curWrap = document.getElementById('currentCourses');
    curWrap.innerHTML = data.current_semester.courses.map(courseCard).join('');

    const pastWrap = document.getElementById('pastCourses');
    pastWrap.innerHTML = data.past_offerings.map(courseCard).join('');

  } catch (err) {
    console.error('Error loading courses:', err);
  }
}

function courseCard(c) {
  const badges = (c.badges || []).map(b => `<span class="badge">${escapeHTML(b)}</span>`).join("");
  const notes = c.notes ? `<p class="small muted">${escapeHTML(c.notes)}</p>` : "";
  const title = `${escapeHTML(c.code)} — ${escapeHTML(c.title)}`;

  // Optional image: add "image": "assets/courses/cs426.jpg" in data/courses.json
  const imgHTML = c.image
    ? `<div class="thumb"><img src="${escapeAttr(c.image)}" alt="${escapeAttr(title)}" onerror="this.closest('.thumb').remove()"></div>`
    : "";

  return `
    <article class="card course-card">
      ${imgHTML}
      <h4>${title}</h4>
      <p>${escapeHTML(c.short || "")}</p>
      <div class="project-meta">${badges}</div>
      ${notes}
    </article>
  `;
}

// tiny sanitizers
function escapeHTML(s){
  return String(s || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(s){
  return String(s || "").replace(/["']/g, m => (m === '"' ? '&quot;' : '&#39;'));
}





    /**
     * Router
     */
    switch (page) {
        case "index.html":         loadHome(); break;
        case "publications.html":  loadPublications(); break;
        case "research.html":      loadProjects(); break;     // ← cards here
        case "grants.html":        loadGrants(); break;
        case "media.html":          loadMedia(); break;
        case "teaching.html":       loadTeaching(); break;
        default:
            // We'll keep adding loaders for the rest of the pages as we go.
            console.log(`No loader defined yet for ${page}`);
    }
});
