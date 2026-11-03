// Extract GitHub user and repository name from URL
const host = window.location.hostname; // e.g., username.github.io
const pathSegments = window.location.pathname.split('/').filter(Boolean);

const username = "MigratoryAtom79";
const repoName = pathSegments.length > 0 ? pathSegments[0] : `${username}.github.io`;

// Repositories to check: current repo & user's profile repo (username/username)
const reposToScan = Array.from(new Set([repoName, username]));

document.getElementById('repo-title').textContent = `${username}'s Project Index`;

const errorBox = document.getElementById('error-box');
const grid = document.getElementById('grid');

async function loadDirectories() {
    try {
    let allDiscoveredProjects = [];

    for (const repo of reposToScan) {
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
        if (response.status === 403) {
            throw new Error("GitHub API rate limit reached. Please wait a few minutes and refresh.");
        }
        continue;
        }

        const items = await response.json();
        const directories = items.filter(item => item.type === 'dir' && !item.name.startsWith('.'));

        // Check each project directory concurrently
        const projectChecks = await Promise.all(
        directories.map(async (dir) => {
            const htmlPath = await findHtmlFile(repo, dir.path);
            if (htmlPath) {
            return {
                name: dir.name,
                repo: repo,
                path: `${dir.path}/${htmlPath}`
            };
            }
            return null;
        })
        );

        allDiscoveredProjects.push(...projectChecks.filter(Boolean));
    }

    if (allDiscoveredProjects.length === 0) {
        grid.innerHTML = `<div class="status-msg">No project directories containing HTML files were found.</div>`;
        return;
    }

    grid.innerHTML = ''; // Clear status message

    allDiscoveredProjects.forEach(project => {
        const targetUrl = project.repo === repoName 
        ? `./${project.path}` 
        : `https://${username}.github.io/${project.repo}/${project.path}`;

        renderCard(project.name, targetUrl, `${project.repo}/${project.path}`);
    });

    } catch (err) {
    grid.innerHTML = '';
    errorBox.style.display = 'block';
    errorBox.textContent = err.message;
    }
}

// Recursively scans a folder for index.html or any .html file
async function findHtmlFile(repo, dirPath) {
    try {
    const url = `https://api.github.com/repos/${username}/${repo}/contents/${dirPath}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const files = await res.json();

    // 1. Check for index.html in current folder (Project2 style)
    const directIndex = files.find(f => f.type === 'file' && f.name.toLowerCase() === 'index.html');
    if (directIndex) return directIndex.name;

    // 2. Check for any .html file directly in folder
    const directHtml = files.find(f => f.type === 'file' && f.name.toLowerCase().endsWith('.html'));
    if (directHtml) return directHtml.name;

    // 3. Scan subdirectories (like "html/" in Project1)
    const subDirs = files.filter(f => f.type === 'dir' && !f.name.startsWith('.'));
    for (const subDir of subDirs) {
        const subUrl = `https://api.github.com/repos/${username}/${repo}/contents/${dirPath}/${subDir.name}`;
        const subRes = await fetch(subUrl);
        if (subRes.ok) {
        const subFiles = await subRes.json();
        const subIndex = subFiles.find(f => f.type === 'file' && f.name.toLowerCase() === 'index.html') 
                        || subFiles.find(f => f.type === 'file' && f.name.toLowerCase().endsWith('.html'));
        if (subIndex) {
            return `${subDir.name}/${subIndex.name}`;
        }
        }
    }

    return null;
    } catch {
    return null;
    }
}

function renderCard(name, targetUrl, displayPath) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = targetUrl;

    const cleanName = name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

    card.innerHTML = `
    <div>
        <div class="card-title">${cleanName}</div>
        <div class="card-path">/${displayPath}</div>
    </div>
    `;
    grid.appendChild(card);
}

async function getREADME(username) {
    const url = `https://raw.githubusercontent.com/${username}/${username}/refs/heads/main/README.md`;
    const response =  await fetch(url);
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
            const readmeSection = document.getElementById('readme-section');
            const readmeContent = document.getElementById('readme-content');
            
            // Parse Markdown into HTML using Marked.js
            readmeContent.innerHTML = marked.parse(markdown);
            readmeSection.style.display = 'block';
        }
    } catch (error) {
        console.error("Failed to render README:", error.message);
    }
}

function calculateAge(birthday) {
    const birthDate = new Date(birthday);
    const ageDifMs = Date.now() - birthDate.getTime();
    
    // Average length of a Gregorian year in milliseconds (365.2425 days)
    const msPerYear = 31556952000; 
    const ageInYears = ageDifMs / msPerYear;
    
    return ageInYears.toFixed(15);
}

function renderAge() {
    const ageTitle = document.getElementById('age-title');
    ageTitle.innerHTML = `I am ${calculateAge("2012-03-15")} yo`;
}

// Execute directory scanner and README rendering
loadDirectories();
renderReadme();

setInterval(renderAge, 50);