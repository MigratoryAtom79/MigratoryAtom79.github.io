const username = "MigratoryAtom79";

const titleEl = document.getElementById("repo-title");
const errorBox = document.getElementById("error-box");
const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const sortSelect = document.getElementById("sort");
const countEl = document.getElementById("count");
const surpriseBtn = document.getElementById("surprise");
const themeBtn = document.getElementById("theme-toggle");
const gridBtn = document.getElementById("view-grid");
const listBtn = document.getElementById("view-list");

const API_BASE = `https://api.github.com`;
const RAW_BASE = `https://raw.githubusercontent.com`;

// All discovered projects (unfiltered) and what is currently displayed.
let allProjects = [];
let visibleProjects = [];


function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
}


function typeTitle(text) {

    titleEl.textContent = "";
    titleEl.classList.add("typing");

    let i = 0;
    const timer = setInterval(() => {
        titleEl.textContent = text.slice(0, ++i);
        if (i >= text.length) {
            clearInterval(timer);
            // Let the cursor blink briefly, then remove it.
            setTimeout(() => titleEl.classList.remove("typing"), 1500);
        }
    }, 45);
}

typeTitle(`${username}'s Project Index`);


// Fetch all public repositories, including paginated results.
async function getRepositories() {
    const repositories = [];
    let page = 1;

    while (true) {
        const url =
            `${API_BASE}/users/${username}/repos?` +
            `type=public&per_page=100&page=${page}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw createApiError(response);
        }

        const batch = await response.json();

        repositories.push(...batch);

        if (batch.length < 100) break;

        page++;
    }

    return repositories;
}

// Fetch a repository's complete file tree.
async function getRepositoryTree(repo) {
    const url =
        `${API_BASE}/repos/${username}/${repo.name}/git/trees/` +
        `${encodeURIComponent(repo.default_branch)}?recursive=1`;

    const response = await fetch(url);

    if (!response.ok) {
        throw createApiError(response);
    }

    const data = await response.json();

    if (data.truncated) {
        console.warn(`Repository tree was truncated: ${repo.name}`);
    }

    return data.tree || [];
}

// Read the contents of webportfolio.txt.
async function readPortfolioFile(repo, branch, filePath) {
    const encodedPath = filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/");

    const url =
        `${RAW_BASE}/${username}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Could not read ${repo}/${filePath}`);
    }

    return (await response.text()).trim();
}

// Find the website folder specified by webportfolio.txt.
async function findWebsite(repo) {
    const tree = await getRepositoryTree(repo);

    const portfolioFiles = tree.filter(file =>
        file.type === "blob" &&
        file.path.split("/").pop().toLowerCase() === "webportfolio.txt"
    );

    const projects = [];

    for (const portfolioFile of portfolioFiles) {
        try {
            const folder = await readPortfolioFile(
                repo.name,
                repo.default_branch,
                portfolioFile.path
            );

            // Treat the file contents as a repository-relative folder path.
            const websiteFolder = folder
                .replace(/^["']|["']$/g, "")
                .replace(/^\.\/+/, "")
                .replace(/\/+$/, "");

            if (!websiteFolder || websiteFolder.startsWith("../")) {
                console.warn(
                    `Invalid website folder in ${repo.name}/${portfolioFile.path}`
                );
                continue;
            }

            const indexPath = `${websiteFolder}/index.html`;

            const indexFile = tree.find(file =>
                file.type === "blob" &&
                file.path.toLowerCase() === indexPath.toLowerCase()
            );

            if (!indexFile) {
                console.warn(
                    `No index.html found at ${repo.name}/${indexPath}`
                );
                continue;
            }

            projects.push({
                name: websiteFolder.split("/").pop(),
                repo: repo.name,
                path: indexPath
            });
        } catch (error) {
            console.warn(
                `Failed to inspect ${repo.name}/${portfolioFile.path}:`,
                error.message
            );
        }
    }

    return projects;
}

// Process repositories with a concurrency limit.
async function mapConcurrent(items, limit, callback) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;

            if (index >= items.length) return;

            try {
                results[index] = await callback(items[index]);
            } catch (error) {
                console.warn(
                    `Failed to scan ${items[index].name}:`,
                    error.message
                );

                results[index] = [];
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(limit, items.length) },
            () => worker()
        )
    );

    return results;
}

// Produce a useful error message for GitHub API failures.
function createApiError(response) {
    if (response.status === 403 || response.status === 429) {
        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = response.headers.get("x-ratelimit-reset");

        if (remaining === "0" && reset) {
            const resetDate = new Date(Number(reset) * 1000);

            return new Error(
                `GitHub API rate limit reached. Resets at ` +
                `${resetDate.toLocaleTimeString()}.`
            );
        }

        return new Error(
            "GitHub API access was denied or rate-limited. " +
            "Try again later."
        );
    }

    return new Error(`GitHub API error: ${response.status}`);
}


function showSkeletons(n = 6) {
    grid.innerHTML = "";
    for (let i = 0; i < n; i++) {
        const sk = document.createElement("div");
        sk.className = "skeleton";
        grid.appendChild(sk);
    }
}

function projectUrl(project) {
    const isProfileRepo = project.repo === `${username}.github.io`;

    return isProfileRepo
        ? `https://${username}.github.io/${project.path}`
        : `https://${username}.github.io/${project.repo}/${project.path}`;
}

/* ---------------- Daily cache (localStorage) ---------------- */

const CACHE_KEY = "projectsCache.v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh once a day

function readCache() {
    try {
        const data = JSON.parse(storageGet(CACHE_KEY));

        if (data && typeof data.savedAt === "number" && Array.isArray(data.projects)) {
            return data;
        }
    } catch { /* corrupt or missing cache */ }

    return null;
}

function writeCache(projects) {
    storageSet(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), projects }));
}

function isFresh(cache) {
    return Boolean(cache) && Date.now() - cache.savedAt < CACHE_TTL_MS;
}

// Scan GitHub for projects. Returns { projects, failedRepos }.
async function scanProjects() {
    const repositories = await getRepositories();

    let failedRepos = 0;

    const results = await mapConcurrent(
        repositories,
        5,
        async repo => {
            try {
                return await findWebsite(repo);
            } catch (error) {
                failedRepos++;
                throw error; // mapConcurrent logs it and records []
            }
        }
    );

    // Remove duplicate website entries.
    const projects = [
        ...new Map(
            results.flat().map(project => [
                `${project.repo}/${project.path}`,
                project
            ])
        ).values()
    ].map((project, index) => ({
        ...project,
        order: index,
        url: projectUrl(project),
        displayPath: `${project.repo}/${project.path}`
    }));

    return { projects, failedRepos };
}

function showProjects(projects, savedAt) {
    allProjects = projects;
    surpriseBtn.disabled = allProjects.length === 0;
    countEl.title = savedAt
        ? `Project list updated ${new Date(savedAt).toLocaleString()}`
        : "";
    applyFilters();
}

let isLoading = false;

async function loadDirectories() {
    if (isLoading) return;
    isLoading = true;

    const cached = readCache();

    try {
        errorBox.style.display = "none";

        // Fresh cache: no API calls at all.
        if (isFresh(cached)) {
            showProjects(cached.projects, cached.savedAt);
            return;
        }

        // Only show placeholders if there is nothing on screen yet.
        if (allProjects.length === 0) {
            if (cached) {
                // Show the stale list instantly while we refresh in the background.
                showProjects(cached.projects, cached.savedAt);
            } else {
                showSkeletons();
            }
        }

        try {
            const { projects, failedRepos } = await scanProjects();

            if (failedRepos === 0) {
                writeCache(projects);
                showProjects(projects, Date.now());
            } else if (cached) {
                // Some repos failed (likely rate limiting): don't overwrite a
                // complete cache with a partial scan.
                console.warn(`${failedRepos} repo(s) failed to scan; keeping cached list.`);
                showProjects(cached.projects, cached.savedAt);
            } else {
                // Nothing cached: show what we found, but don't cache a partial result.
                console.warn(`${failedRepos} repo(s) failed to scan; result not cached.`);
                showProjects(projects, null);
            }
        } catch (error) {
            // Network / rate-limit failure: fall back to stale data if we have any.
            if (cached) {
                console.warn("Refresh failed, using cached list:", error.message);
                showProjects(cached.projects, cached.savedAt);
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error("Failed to load projects:", error);

        grid.innerHTML = "";
        errorBox.style.display = "block";
        errorBox.textContent = error.message;
    } finally {
        isLoading = false;
    }
}

// If the page stays open for a long time, refresh once the cache goes stale.
function refreshIfStale() {
    if (!document.hidden && !isFresh(readCache())) {
        loadDirectories();
    }
}

document.addEventListener("visibilitychange", refreshIfStale);
setInterval(refreshIfStale, 60 * 60 * 1000);

// Filter by search text, then sort, then render.
function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();

    visibleProjects = allProjects.filter(p =>
        !query ||
        p.name.toLowerCase().includes(query) ||
        p.displayPath.toLowerCase().includes(query)
    );

    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

    switch (sortSelect.value) {
        case "az":
            visibleProjects.sort((a, b) => collator.compare(a.name, b.name));
            break;
        case "za":
            visibleProjects.sort((a, b) => collator.compare(b.name, a.name));
            break;
        case "repo":
            visibleProjects.sort((a, b) =>
                collator.compare(a.repo, b.repo) || collator.compare(a.name, b.name));
            break;
        default:
            visibleProjects.sort((a, b) => a.order - b.order);
    }

    renderCards();
}

function renderCards() {
    grid.innerHTML = "";

    countEl.textContent = allProjects.length
        ? `${visibleProjects.length}/${allProjects.length}`
        : "";

    if (allProjects.length === 0) {
        grid.innerHTML = '<div class="status-msg">No websites found.</div>';
        return;
    }

    if (visibleProjects.length === 0) {
        grid.innerHTML =
            '<div class="status-msg">No projects match your search.</div>';
        return;
    }

    visibleProjects.forEach((project, i) => {
        const card = renderCard(project);
        // Staggered fade-in.
        setTimeout(() => card.classList.add("visible"), Math.min(i * 40, 400));
    });
}

function renderCard(project) {
    const card = document.createElement("a");
    card.className = "card";
    card.href = project.url;
    card.dataset.key = project.displayPath;

    const cleanName = project.repo
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, char => char.toUpperCase());

    // Build with textContent so repo names can never inject markup.
    const wrapper = document.createElement("div");

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = cleanName;

    const path = document.createElement("div");
    path.className = "card-path";
    path.textContent = `/${project.displayPath}`;

    const arrow = document.createElement("span");
    arrow.className = "card-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";

    wrapper.append(title, path);
    card.append(wrapper, arrow);

    attachCardEffects(card);
    grid.appendChild(card);

    return card;
}

// Cursor spotlight + subtle 3D tilt.
function attachCardEffects(card) {

    card.addEventListener("mousemove", event => {
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        card.style.setProperty("--mx", `${x}px`);
        card.style.setProperty("--my", `${y}px`);

        if (grid.classList.contains("list-view")) return;

        card.style.setProperty("--ry", `${((x / rect.width) - 0.5) * 8}deg`);
        card.style.setProperty("--rx", `${((y / rect.height) - 0.5) * -8}deg`);
    });

    card.addEventListener("mouseleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
    });
}

/* ------------------------------------------------------------------ */
/*  README                                                             */
/* ------------------------------------------------------------------ */

async function getREADME(username) {
    const url = `https://raw.githubusercontent.com/${username}/${username}/refs/heads/main/README.md`;
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 403) {
            throw new Error("GitHub API rate limit reached. Please wait a few minutes and refresh.");
        }
        return;
    }
    return response.text();
}

async function renderReadme() {
    try {
        const markdown = await getREADME(username);
        if (markdown) {
            const readmeSection = document.getElementById("readme-section");
            const readmeContent = document.getElementById("readme-content");

            // Parse Markdown into HTML using Marked.js
            readmeContent.innerHTML = marked.parse(markdown);
            readmeSection.style.display = "block";
        }
    } catch (error) {
        console.error("Failed to render README:", error.message);
    }
}


const BIRTHDAY = "2012-03-15";
const PRECISIONS = [15, 9, 2, 0];
let precisionIndex = 0;

function calculateAge(birthday, digits) {
    const birthDate = new Date(birthday);
    const ageDifMs = Date.now() - birthDate.getTime();

    // Average length of a Gregorian year in milliseconds (365.2425 days)
    const msPerYear = 31556952000;
    return (ageDifMs / msPerYear).toFixed(digits);
}

function renderAgeAndLocation() {
    const ageTitle = document.getElementById("age-title");
    const locTitle = document.getElementById("loc-title");
    ageTitle.innerHTML =
        `I am <strong>${calculateAge(BIRTHDAY, PRECISIONS[precisionIndex])} yo</strong>`;
    locTitle.innerHTML = `Approximate location <a href="https://maps.app.goo.gl/HPkvsJcEJcXUb3NU8"><strong>50.822817268752054, 4.34201087929731</strong></a>`
}

document.getElementById("age-title").addEventListener("click", () => {
    precisionIndex = (precisionIndex + 1) % PRECISIONS.length;
    renderAgeAndLocation();
});


searchInput.addEventListener("input", applyFilters);
sortSelect.addEventListener("change", () => {
    storageSet("sort", sortSelect.value);
    applyFilters();
});

// Press "/" anywhere to jump to search; Esc clears it.
document.addEventListener("keydown", event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

    if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
    } else if (event.key === "Escape" && document.activeElement === searchInput) {
        searchInput.value = "";
        searchInput.blur();
        applyFilters();
    } else if (event.key === "Enter" && document.activeElement === searchInput &&
        visibleProjects.length === 1) {
        window.location.href = visibleProjects[0].url;
    }
});

// Theme toggle.
function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    storageSet("theme", theme);
}

themeBtn.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme ||
        (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    setTheme(current === "light" ? "dark" : "light");
});

// Grid / list view.
function setView(view) {
    const isList = view === "list";
    grid.classList.toggle("list-view", isList);
    gridBtn.classList.toggle("active", !isList);
    listBtn.classList.toggle("active", isList);
    gridBtn.setAttribute("aria-pressed", String(!isList));
    listBtn.setAttribute("aria-pressed", String(isList));
    storageSet("view", view);
}

gridBtn.addEventListener("click", () => setView("grid"));
listBtn.addEventListener("click", () => setView("list"));

// Surprise me: flash a random project, then open it.
surpriseBtn.addEventListener("click", () => {
    const pool = visibleProjects.length ? visibleProjects : allProjects;
    if (!pool.length) return;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    const card = [...grid.querySelectorAll(".card")]
        .find(c => c.dataset.key === pick.displayPath);

    if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("flash");
        setTimeout(() => { window.location.href = pick.url; }, 900);
    } else {
        window.location.href = pick.url;
    }
});

const SOCIALS = {
    github: {username: username},
    discord: {
        userId: "1428376989877669964",
        username: "migratoryatom79"
    },
    steam: {
        id: "76561199324772784",
        username: "MigratoryAtom79"
    }
};

const ICON_DIR = "icons";

function buildSocials() {
    const items = [];

    const github = SOCIALS.github || {};
    if (github.username) {
        items.push({
            platform: "GitHub",
            icon: "github",
            name: github.username,
            href: `https://github.com/${encodeURIComponent(github.username)}`
        });
    }

    const discord = SOCIALS.discord || {};
    if (discord.userId || discord.username) {
        items.push({
            platform: "Discord",
            icon: "discord",
            name: discord.username || "Discord profile",
            href: discord.userId
                ? `https://discord.com/users/${encodeURIComponent(discord.userId)}`
                : null,
            copy: discord.userId ? null : discord.username
        });
    }

    const steam = SOCIALS.steam || {};
    if (steam.id) {
        const id = encodeURIComponent(steam.id);
        items.push({
            platform: "Steam",
            icon: "steam",
            name: steam.username || (/^\d{17}$/.test(steam.id) ? "Steam profile" : steam.id),
            href: /^\d{17}$/.test(steam.id)
                ? `https://steamcommunity.com/profiles/${id}`
                : `https://steamcommunity.com/id/${id}`
        });
    }

    return items;
}

function renderSocials() {
    const nav = document.getElementById("socials");

    buildSocials().forEach(item => {
        let el;

        if (item.href) {
            el = document.createElement("a");
            el.href = item.href;
            el.target = "_blank";
            el.rel = "noopener noreferrer";
        } else {
            // No public URL: copy the username instead.
            el = document.createElement("button");
            el.type = "button";
            el.title = `Copy ${item.copy}`;
        }

        el.className = "social";
        el.setAttribute("aria-label", `${item.platform}: ${item.name}`);

        // Logo, with a text fallback if the file isn't there.
        const icon = document.createElement("img");
        icon.src = `${ICON_DIR}/${item.icon}.svg`;
        icon.alt = "";
        icon.width = 16;
        icon.height = 16;
        icon.addEventListener("error", () => {
            icon.remove();
            const label = document.createElement("span");
            label.className = "social-platform";
            label.textContent = item.platform;
            el.prepend(label);
        });

        const nameEl = document.createElement("span");
        nameEl.className = "social-name";
        nameEl.textContent = item.name;

        el.append(icon, nameEl);

        if (!item.href) {
            el.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(item.copy);
                    nameEl.textContent = "Copied!";
                } catch {
                    nameEl.textContent = item.copy;
                }
                setTimeout(() => { nameEl.textContent = item.name; }, 1500);
            });
        }

        nav.appendChild(el);
    });
}


renderSocials();


const savedSort = storageGet("sort");
if (savedSort && [...sortSelect.options].some(o => o.value === savedSort)) {
    sortSelect.value = savedSort;
}

setView(storageGet("view") === "list" ? "list" : "grid");

renderAgeAndLocation();
setInterval(renderAgeAndLocation, 50);



loadDirectories();
renderReadme();