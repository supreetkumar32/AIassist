
'use strict';

const JiraAI = (function () {

    // ── State ──────────────────────────────────────────────────────────────

    let _projectKey  = '';
    let _issueKey    = '';
    let _ctx         = '';   // AJS.contextPath()
    let _busy        = false;

    // ── Bootstrap ─────────────────────────────────────────────────────────

    function init(projectKey, issueKey, contextPath) {
        _projectKey   = projectKey  || '';
        _issueKey     = issueKey    || '';
        _ctx          = contextPath || '';

        //nine
        console.log('[AI Assistant] ===== init() called =====');
        console.log('[AI Assistant] init → raw args:', { projectKey: projectKey, issueKey: issueKey, contextPath: contextPath });
        console.log('[AI Assistant] init → resolved state:', { _projectKey: _projectKey, _issueKey: _issueKey, _ctx: _ctx });
        _bindEvents();
        //eleven
        _addBotMessage(_welcomeCard());
        console.log('[AI Assistant] init() complete — widget ready for input');
    }

    // ── Event bindings ─────────────────────────────────────────────────────

    //ten
    function _bindEvents() {
        console.log('[AI Assistant] _bindEvents() → wiring send button, Enter key, and chip click handlers');
        const sendBtn = document.getElementById('ai-send-btn');
        const input   = document.getElementById('ai-user-input');

        sendBtn.addEventListener('click', _handleSend);

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _handleSend();
            }
        });

        // Quick-action chips
        document.querySelectorAll('.ai-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                const prompt = chip.getAttribute('data-prompt');
                console.log('[AI Assistant] chip clicked → prompt:', JSON.stringify(prompt));
                input.value = prompt;
                input.focus();
                // Chips that end with a space are "starters" → don't auto-send
                if (!prompt.endsWith(' ')) {
                    _handleSend();
                } else {
                    console.log('[AI Assistant] chip is a "starter" (ends with space) — waiting for user to finish typing before sending');
                }
            });
        });
    }

    async function _handleSend() {
        if (_busy) {
            console.log('[AI Assistant] _handleSend() ignored — already busy processing a previous message');
            return;
        }

        const input = document.getElementById('ai-user-input');
        const text  = input.value.trim();
        if (!text) {
            console.log('[AI Assistant] _handleSend() ignored — input was empty');
            return;
        }

        console.log('[AI Assistant] ===== _handleSend() called =====');
        console.log('[AI Assistant] user input:', JSON.stringify(text));

        input.value = '';
        _addUserMessage(text);
        _setBusy(true);
        _showTyping();

        try {
            const html = await _processMessage(text);
            console.log('[AI Assistant] _processMessage() resolved — rendering bot response HTML (length:', html ? html.length : 0, 'chars)');
            _hideTyping();
            _addBotMessage(html);
        } catch (err) {
            console.error('[AI Assistant] _handleSend() caught an error:', err);
            _hideTyping();
            _addBotMessage(_errorCard('Unexpected error: ' + err.message));
        } finally {
            _setBusy(false);
            console.log('[AI Assistant] _handleSend() finished — busy flag cleared');
        }
    }

    // ── AI agent (Google ADK / GPT-4o mini) ────────────────────────────────
    // Primary path: send the raw message to the server-side agent, which
    // understands free-form/misspelled requests (e.g. "craete a story for
    // login page crash") and decides which Jira tool to call. If the agent
    // service is unreachable, we gracefully fall back to the local regex
    // intent parser below so the widget keeps working offline.

    async function _callAiAgent(message) {
        const resp = await _jiraFetch('/rest/aiassistant/1.0/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ message: message, projectKey: _projectKey, issueKey: _issueKey })
        });
        if (!resp.ok) {
            console.warn('[AI Assistant] _callAiAgent() → agent endpoint returned status', resp.status, '- will fall back to local parser');
            return null;
        }
        return await resp.json();
    }

    function _renderAgentResult(data) {
        if (!data) return null;

        if (data.status === 'error') {
            console.warn('[AI Assistant] _renderAgentResult() → agent returned error:', data.error_message);
            return _errorCard(_escHtml(data.error_message || data.replyText || 'The AI agent could not complete this request.'));
        }

        switch (data.action) {
            case 'create_issue':
                return _successCard(
                    'Issue Created ✅',
                    '<a href="' + _ctx + '/browse/' + data.key + '" target="_blank" class="ai-issue-link">' + data.key + '</a>'
                    + ' — ' + _escHtml(data.summary || ''),
                    'Type: <strong>' + _escHtml(data.issueType || '') + '</strong> &nbsp;|&nbsp; Project: <strong>' + _escHtml(data.project || '') + '</strong>'
                );
            case 'edit_issue':
                return _successCard(
                    'Issue Updated ✅',
                    '<a href="' + _ctx + '/browse/' + data.key + '" target="_blank" class="ai-issue-link">' + data.key + '</a>'
                    + ' — <strong>' + _escHtml(data.field || '') + '</strong> set to "' + _escHtml(data.value || '') + '"'
                );
            case 'list_issues':
            case 'search_issues':
                return _renderAgentIssueList(data);
            case 'summarize_sprint':
                return _renderAgentSprintSummary(data);
            case 'chat':
            default:
                return _infoCard('AI Assistant', _escHtml(data.replyText || 'Done.'));
        }
    }

    function _renderAgentIssueList(data) {
        const issues = data.issues || [];
        if (issues.length === 0) {
            return _infoCard(data.title || 'Issues', 'No issues found matching your criteria.');
        }

        const rows = issues.map(function (issue) {
            return '<tr class="ai-issue-row">'
                +  '<td><a href="' + _ctx + '/browse/' + issue.key + '" target="_blank" class="ai-issue-link">' + issue.key + '</a></td>'
                +  '<td class="ai-issue-summary-cell" title="' + _escHtml(issue.summary) + '">' + _escHtml(issue.summary) + '</td>'
                +  '<td><span class="ai-status-badge">' + _escHtml(issue.status) + '</span></td>'
                +  '<td>' + _escHtml(issue.issuetype) + '</td>'
                +  '<td>' + _escHtml(issue.assignee) + '</td>'
                +  '</tr>';
        }).join('');

        const moreHint = data.total > issues.length
            ? '<div class="ai-more-hint">Showing ' + issues.length + ' of ' + data.total + ' total issues</div>'
            : '';

        return (
            '<div class="ai-issue-list-card">'
          +   '<div class="ai-list-header">' + _escHtml(data.title || 'Issues') + ' <span class="ai-count-badge">' + data.total + '</span></div>'
          +   '<table class="ai-issues-table">'
          +     '<thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Type</th><th>Assignee</th></tr></thead>'
          +     '<tbody>' + rows + '</tbody>'
          +   '</table>'
          +   moreHint
          + '</div>'
        );
    }

    function _renderAgentSprintSummary(data) {
        const statusRows = Object.entries(data.statusCounts || {}).map(function ([s, c]) {
            return '<tr><td>' + _escHtml(s) + '</td><td><strong>' + c + '</strong></td></tr>';
        }).join('');

        const typeRows = Object.entries(data.typeCounts || {}).map(function ([t, c]) {
            return '<tr><td>' + _escHtml(t) + '</td><td><strong>' + c + '</strong></td></tr>';
        }).join('');

        return (
            '<div class="ai-sprint-card">'
          +   '<div class="ai-sprint-header">'
          +     '<span class="ai-sprint-icon">🚀</span>'
          +     '<div>'
          +       '<div class="ai-sprint-name">' + _escHtml(data.sprintName) + '</div>'
          +       '<div class="ai-sprint-dates">' + _escHtml(data.startDate) + ' → ' + _escHtml(data.endDate) + '</div>'
          +     '</div>'
          +   '</div>'
          +   '<div class="ai-progress-bar-container">'
          +     '<div class="ai-progress-bar" style="width:' + data.progress + '%"></div>'
          +   '</div>'
          +   '<div class="ai-progress-label">' + data.done + ' / ' + data.total + ' issues completed (' + data.progress + '%)</div>'
          +   '<div class="ai-sprint-tables">'
          +     '<div class="ai-sprint-table-block">'
          +       '<div class="ai-table-title">By Status</div>'
          +       '<table class="ai-mini-table"><tbody>' + statusRows + '</tbody></table>'
          +     '</div>'
          +     '<div class="ai-sprint-table-block">'
          +       '<div class="ai-table-title">By Type</div>'
          +       '<table class="ai-mini-table"><tbody>' + typeRows + '</tbody></table>'
          +     '</div>'
          +   '</div>'
          + '</div>'
        );
    }

    // ── Intent routing ─────────────────────────────────────────────────────

    async function _processMessage(message) {
        console.log('[AI Assistant] _processMessage() → message:', JSON.stringify(message));

        try {
            const agentData = await _callAiAgent(message);
            const rendered   = _renderAgentResult(agentData);
            if (rendered) {
                console.log('[AI Assistant] _processMessage() → handled by AI agent, action:', agentData && agentData.action);
                return rendered;
            }
        } catch (err) {
            console.warn('[AI Assistant] _processMessage() → AI agent call failed, falling back to local intent parser:', err);
        }

        const intent = _parseIntent(message);
        console.log('[AI Assistant] _processMessage() → parsed intent (fallback):', JSON.stringify(intent));
        switch (intent.type) {
            case 'CREATE_ISSUE':
                console.log('[AI Assistant] routing → _createIssue()', intent.params);
                return await _createIssue(intent.params);
            case 'SUMMARIZE_SPRINT':
                console.log('[AI Assistant] routing → _summarizeSprint()', intent.params);
                return await _summarizeSprint(intent.params.projectOverride);
            case 'LIST_ISSUES':
                console.log('[AI Assistant] routing → _listIssues()', intent.params);
                return await _listIssues(intent.params);
            case 'SEARCH_ISSUES':
                console.log('[AI Assistant] routing → _searchIssues()', intent.params);
                return await _searchIssues(intent.params);
            case 'EDIT_ISSUE':
                console.log('[AI Assistant] routing → _editIssue()', intent.params);
                return await _editIssue(intent.params);
            case 'HELP':
                console.log('[AI Assistant] routing → _helpCard()');
                return _helpCard();
            default:
                console.warn('[AI Assistant] routing → unrecognized intent.type "' + intent.type + '", falling back to _searchIssues() with raw message');
                return await _searchIssues({ query: message });
        }
    }

    // ── Intent parser ──────────────────────────────────────────────────────

    // Matches a trailing project-key hint, e.g. "... in PROJ" or "... for project PROJ".
    // Lets the assistant work outside of any project/issue page (dashboards, boards, etc.)
    const TRAILING_PROJECT_RX = /\s+(?:in|for(?:\s+project)?)\s+([A-Za-z][A-Za-z0-9_]{1,9})\s*$/i;

    function _parseIntent(message) {
        // Strip a single pair of wrapping quotes (straight or curly) that users
        // sometimes include when typing/pasting a command, e.g. '"create a bug for X"'.
        // Without this, the anchored regexes below (which expect the message to
        // start with "create"/"list"/etc.) would never match and everything would
        // silently fall through to the free-text search fallback.
        let msg = message.trim();
        const QUOTE_WRAP_RX = /^["'“”‘’](.*)["'“”‘’]$/;
        const quoteWrapMatch = msg.match(QUOTE_WRAP_RX);
        if (quoteWrapMatch) {
            console.log('[AI Assistant] _parseIntent() → stripped wrapping quotes from message');
            msg = quoteWrapMatch[1].trim();
        }
        console.log('[AI Assistant] _parseIntent() → normalized message:', JSON.stringify(msg));

        let trailingProject = null;
        const trailingMatch = msg.match(TRAILING_PROJECT_RX);
        if (trailingMatch) {
            trailingProject = trailingMatch[1].toUpperCase();
            console.log('[AI Assistant] _parseIntent() → trailing project detected:', trailingProject);
        }

        // CREATE ISSUE with explicit project: "create a bug in PROJ for login page crash"
        const createWithProjectRx = /^(?:create|add|new)\s+(?:a\s+)?(?:new\s+)?(bug|story|task|epic|feature|improvement|sub-?task)\s+in\s+([A-Za-z][A-Za-z0-9_]{1,9})\s+for\s+(.+)$/i;
        const createWithProjectMatch = msg.match(createWithProjectRx);
        if (createWithProjectMatch) {
            console.log('[AI Assistant] _parseIntent() → matched createWithProjectRx:', createWithProjectMatch);
            return {
                type: 'CREATE_ISSUE',
                params: {
                    issueType: createWithProjectMatch[1],
                    projectOverride: createWithProjectMatch[2].toUpperCase(),
                    summary: createWithProjectMatch[3].trim()
                }
            };
        }

        // CREATE ISSUE: "create a bug for login page crash"
        const createRx = /^(?:create|add|new)\s+(?:a\s+)?(?:new\s+)?(bug|story|task|epic|feature|improvement|sub-?task)\s*(?:for|:|-|—|–)?\s*(.+)$/i;
        const createMatch = msg.match(createRx);
        if (createMatch) {
            console.log('[AI Assistant] _parseIntent() → matched createRx (no explicit project):', createMatch);
            return { type: 'CREATE_ISSUE', params: { issueType: createMatch[1], summary: createMatch[2].trim() } };
        }

        // SUMMARIZE SPRINT (optionally "summarize sprint for PROJ")
        if (/summar(?:ize|y)|sprint\s+(?:status|overview|report|progress)|what(?:'s|\s+is)\s+in\s+(?:the\s+)?sprint|show\s+sprint/i.test(msg)) {
            console.log('[AI Assistant] _parseIntent() → matched SUMMARIZE_SPRINT, projectOverride:', trailingProject);
            return { type: 'SUMMARIZE_SPRINT', params: { projectOverride: trailingProject } };
        }

        // LIST MY ISSUES
        if (/my\s+(?:open\s+)?issues?|assigned\s+to\s+me/i.test(msg)) {
            console.log('[AI Assistant] _parseIntent() → matched LIST_ISSUES (mine), projectOverride:', trailingProject);
            return { type: 'LIST_ISSUES', params: { filter: 'mine', projectOverride: trailingProject } };
        }

        // LIST OPEN ISSUES
        if (/(?:list|show|get)\s+(?:all\s+)?open\s+issues?/i.test(msg)) {
            console.log('[AI Assistant] _parseIntent() → matched LIST_ISSUES (open), projectOverride:', trailingProject);
            return { type: 'LIST_ISSUES', params: { filter: 'open', projectOverride: trailingProject } };
        }

        // LIST ALL ISSUES
        if (/(?:list|show|get)\s+(?:all\s+)?issues?/i.test(msg)) {
            console.log('[AI Assistant] _parseIntent() → matched LIST_ISSUES (all), projectOverride:', trailingProject);
            return { type: 'LIST_ISSUES', params: { filter: 'all', projectOverride: trailingProject } };
        }

        // EDIT ISSUE: "update PROJ-123 priority to high"
        const editRx = /^(?:edit|update|set|change)\s+([A-Z][A-Z0-9_]+-\d+)\s+(.+?)\s+to\s+(.+)$/i;
        const editMatch = msg.match(editRx);
        if (editMatch) {
            console.log('[AI Assistant] _parseIntent() → matched EDIT_ISSUE:', editMatch);
            return { type: 'EDIT_ISSUE', params: { key: editMatch[1].toUpperCase(), field: editMatch[2].trim(), value: editMatch[3].trim() } };
        }

        // SEARCH: "search for authentication" (optionally "... in PROJ")
        const searchRx = /^(?:search|find)\s+(?:for\s+)?(?:issues?\s+(?:about|related\s+to|with)\s+)?(.+)$/i;
        const searchMatch = msg.match(searchRx);
        if (searchMatch) {
            let query = searchMatch[1].trim();
            if (trailingProject) {
                query = query.replace(TRAILING_PROJECT_RX, '').trim();
            }
            console.log('[AI Assistant] _parseIntent() → matched SEARCH_ISSUES (explicit search), query:', JSON.stringify(query), ' projectOverride:', trailingProject);
            return { type: 'SEARCH_ISSUES', params: { query: query, projectOverride: trailingProject } };
        }

        // HELP
        if (/^help$|what\s+can\s+you\s+do|^commands?$/i.test(msg)) {
            console.log('[AI Assistant] _parseIntent() → matched HELP');
            return { type: 'HELP', params: {} };
        }

        // Default: treat as free-text search
        let fallbackQuery = msg;
        if (trailingProject) {
            fallbackQuery = fallbackQuery.replace(TRAILING_PROJECT_RX, '').trim();
        }
        console.warn('[AI Assistant] _parseIntent() → no pattern matched, falling back to free-text SEARCH_ISSUES, query:', JSON.stringify(fallbackQuery), ' projectOverride:', trailingProject);
        return { type: 'SEARCH_ISSUES', params: { query: fallbackQuery, projectOverride: trailingProject } };
    }

    // ── Create issue ───────────────────────────────────────────────────────

    // Resolves the project to operate on: an explicit override from the message
    // (e.g. "... in PROJ") takes precedence, otherwise falls back to whatever
    // project was auto-detected from the current page (may be empty on
    // dashboards / global pages).
    function _resolveProject(projectOverride) {
        const resolved = (projectOverride || _projectKey || '').toUpperCase();
        console.log('[AI Assistant] _resolveProject() → projectOverride:', projectOverride, ' _projectKey (auto-detected):', _projectKey, ' → resolved:', resolved);
        return resolved;
    }

    // Fallback aliases in case createmeta lookup fails (network error, no permission, etc.).
    // Note: some Jira Data Center instances rename "Bug" to "Bugfix" — the dynamic
    // lookup below is the source of truth; this map is only a last resort.
    const _issueTypeAliases = {
        bug: ['bugfix', 'bug'], story: ['story'], task: ['task'], epic: ['epic'],
        feature: ['feature'], improvement: ['improvement'],
        subtask: ['sub-task', 'subtask'], 'sub-task': ['sub-task', 'subtask']
    };

    // Asks Jira which issue types actually exist for the target project, then
    // matches the user's requested type (e.g. "bug") against the real names
    // (e.g. "Bugfix"), so we never send an issue type name Jira doesn't recognize.
    async function _resolveIssueType(projectKey, issueType) {
        const key = (issueType || '').toLowerCase();
        const aliases = _issueTypeAliases[key] || [key];

        try {
            const resp = await _jiraFetch(
                '/rest/api/2/issue/createmeta?projectKeys=' + encodeURIComponent(projectKey) + '&expand=projects.issuetypes'
            );
            if (resp.ok) {
                const data = await resp.json();
                const project = data.projects && data.projects[0];
                const types = (project && project.issuetypes) || [];
                console.log('[AI Assistant] _resolveIssueType() → available issue types for', projectKey, ':', types.map(t => t.name));
                for (const alias of aliases) {
                    const match = types.find(t => t.name.toLowerCase() === alias);
                    if (match) {
                        console.log('[AI Assistant] _resolveIssueType() → matched "' + issueType + '" → "' + match.name + '"');
                        return match.name;
                    }
                }
                console.warn('[AI Assistant] _resolveIssueType() → no match found among available types for alias set:', aliases);
            } else {
                console.warn('[AI Assistant] _resolveIssueType() → createmeta lookup failed with status:', resp.status);
            }
        } catch (err) {
            console.error('[AI Assistant] _resolveIssueType() → createmeta lookup errored:', err);
        }

        // Fallback: best-guess capitalization from the alias list.
        const fallback = aliases[0] || 'task';
        const capitalized = fallback.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('-');
        console.warn('[AI Assistant] _resolveIssueType() → falling back to guessed name:', capitalized);
        return capitalized;
    }

    async function _createIssue({ issueType, summary, projectOverride }) {
        console.log('[AI Assistant] _createIssue() → params:', { issueType: issueType, summary: summary, projectOverride: projectOverride });
        const resolvedProject = _resolveProject(projectOverride);
        if (!resolvedProject) {
            console.warn('[AI Assistant] _createIssue() → no project could be resolved, aborting with guidance card');
            return _errorCard(
                'I don\'t know which project to create this in. Try '
                + '<span class="ai-help-cmd">create a bug in PROJ for &lt;summary&gt;</span>, '
                + 'or open me from an issue/project page.'
            );
        }

        const resolvedType = await _resolveIssueType(resolvedProject, issueType);
        console.log('[AI Assistant] _createIssue() → resolvedProject:', resolvedProject, ' resolvedType:', resolvedType);

        const body = {
            fields: {
                project:   { key: resolvedProject },
                summary:   summary,
                issuetype: { name: resolvedType }
            }
        };
        console.log('[AI Assistant] _createIssue() → POST /rest/api/2/issue body:', JSON.stringify(body));

        const resp = await _jiraFetch('/rest/api/2/issue', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
            body:    JSON.stringify(body)
        });
        console.log('[AI Assistant] _createIssue() → response status:', resp.status, resp.ok ? '(ok)' : '(failed)');

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            const msg = err.errors ? Object.values(err.errors).join(', ') : (resp.statusText || 'Unknown error');
            console.error('[AI Assistant] _createIssue() → failed:', msg, err);
            return _errorCard('Failed to create issue: ' + _escHtml(msg));
        }

        const data = await resp.json();
        console.log('[AI Assistant] _createIssue() → created issue key:', data.key);
        return _successCard(
            'Issue Created ✅',
            '<a href="' + _ctx + '/browse/' + data.key + '" target="_blank" class="ai-issue-link">' + data.key + '</a>'
            + ' — ' + _escHtml(summary),
            'Type: <strong>' + resolvedType + '</strong> &nbsp;|&nbsp; Project: <strong>' + _escHtml(resolvedProject) + '</strong>'
        );
    }

    // ── Summarize sprint ───────────────────────────────────────────────────

    async function _summarizeSprint(projectOverride) {
        console.log('[AI Assistant] _summarizeSprint() → projectOverride:', projectOverride);
        const resolvedProject = _resolveProject(projectOverride);
        if (!resolvedProject) {
            console.warn('[AI Assistant] _summarizeSprint() → no project could be resolved, aborting with guidance card');
            return _errorCard(
                'I don\'t know which project to summarize. Try '
                + '<span class="ai-help-cmd">summarize sprint for PROJ</span>, '
                + 'or open me from a project/issue page.'
            );
        }

        // 1. Get boards for the project
        console.log('[AI Assistant] _summarizeSprint() → fetching boards for project:', resolvedProject);
        const boardsResp = await _jiraFetch('/rest/agile/1.0/board?projectKeyOrId=' + encodeURIComponent(resolvedProject) + '&maxResults=10');
        if (!boardsResp.ok) {
            console.error('[AI Assistant] _summarizeSprint() → failed to load boards, status:', boardsResp.status);
            return _errorCard('Could not load agile boards. The project may not have a board configured.');
        }
        const boards = await boardsResp.json();
        console.log('[AI Assistant] _summarizeSprint() → boards found:', boards.values ? boards.values.length : 0);
        if (!boards.values || boards.values.length === 0) {
            return _infoCard('No Board Found', 'No agile board found for project <strong>' + _escHtml(resolvedProject) + '</strong>.');
        }

        const boardId   = boards.values[0].id;
        const boardName = boards.values[0].name;
        console.log('[AI Assistant] _summarizeSprint() → using board:', boardId, boardName);

        // 2. Get active sprint
        const sprintResp = await _jiraFetch('/rest/agile/1.0/board/' + boardId + '/sprint?state=active&maxResults=1');
        if (!sprintResp.ok) {
            console.error('[AI Assistant] _summarizeSprint() → failed to fetch active sprint, status:', sprintResp.status);
            return _errorCard('Could not fetch active sprint for board "' + _escHtml(boardName) + '".');
        }
        const sprintData = await sprintResp.json();
        if (!sprintData.values || sprintData.values.length === 0) {
            console.warn('[AI Assistant] _summarizeSprint() → no active sprint found for board:', boardName);
            return _infoCard('No Active Sprint', 'Board <strong>' + _escHtml(boardName) + '</strong> has no active sprint.');
        }

        const sprint = sprintData.values[0];
        console.log('[AI Assistant] _summarizeSprint() → active sprint:', sprint.id, sprint.name);

        // 3. Get sprint issues
        const issuesResp = await _jiraFetch(
            '/rest/agile/1.0/sprint/' + sprint.id + '/issue?maxResults=100&fields=summary,status,issuetype,assignee'
        );
        if (!issuesResp.ok) {
            console.error('[AI Assistant] _summarizeSprint() → failed to fetch sprint issues, status:', issuesResp.status);
            return _errorCard('Could not fetch sprint issues.');
        }

        const issuesData = await issuesResp.json();
        const issues = issuesData.issues || [];
        console.log('[AI Assistant] _summarizeSprint() → issues in sprint:', issues.length);

        // 4. Aggregate
        const statusCounts = {};
        const typeCounts   = {};

        issues.forEach(function (issue) {
            const status = issue.fields.status.name;
            const type   = issue.fields.issuetype.name;
            statusCounts[status] = (statusCounts[status] || 0) + 1;
            typeCounts[type]     = (typeCounts[type]     || 0) + 1;
        });

        const done     = issues.filter(function (i) { return /done|closed|resolved/i.test(i.fields.status.statusCategory ? i.fields.status.statusCategory.key : i.fields.status.name); }).length;
        const progress = issues.length > 0 ? Math.round((done / issues.length) * 100) : 0;

        const startDate = sprint.startDate ? sprint.startDate.substring(0, 10) : 'N/A';
        const endDate   = sprint.endDate   ? sprint.endDate.substring(0, 10)   : 'N/A';

        const statusRows = Object.entries(statusCounts).map(function ([s, c]) {
            return '<tr><td>' + _escHtml(s) + '</td><td><strong>' + c + '</strong></td></tr>';
        }).join('');

        const typeRows = Object.entries(typeCounts).map(function ([t, c]) {
            return '<tr><td>' + _escHtml(t) + '</td><td><strong>' + c + '</strong></td></tr>';
        }).join('');

        return (
            '<div class="ai-sprint-card">'
          +   '<div class="ai-sprint-header">'
          +     '<span class="ai-sprint-icon">🚀</span>'
          +     '<div>'
          +       '<div class="ai-sprint-name">' + _escHtml(sprint.name) + '</div>'
          +       '<div class="ai-sprint-dates">' + startDate + ' → ' + endDate + '</div>'
          +     '</div>'
          +   '</div>'
          +   '<div class="ai-progress-bar-container">'
          +     '<div class="ai-progress-bar" style="width:' + progress + '%"></div>'
          +   '</div>'
          +   '<div class="ai-progress-label">' + done + ' / ' + issues.length + ' issues completed (' + progress + '%)</div>'
          +   '<div class="ai-sprint-tables">'
          +     '<div class="ai-sprint-table-block">'
          +       '<div class="ai-table-title">By Status</div>'
          +       '<table class="ai-mini-table"><tbody>' + statusRows + '</tbody></table>'
          +     '</div>'
          +     '<div class="ai-sprint-table-block">'
          +       '<div class="ai-table-title">By Type</div>'
          +       '<table class="ai-mini-table"><tbody>' + typeRows + '</tbody></table>'
          +     '</div>'
          +   '</div>'
          + '</div>'
        );
    }

    // ── List issues ────────────────────────────────────────────────────────

    async function _listIssues({ filter, projectOverride }) {
        console.log('[AI Assistant] _listIssues() → filter:', filter, ' projectOverride:', projectOverride);
        const resolvedProject = _resolveProject(projectOverride);
        const projectClause   = resolvedProject ? 'project = ' + resolvedProject + ' AND ' : '';
        const projectSuffix   = resolvedProject ? ' in ' + resolvedProject : '';
        let jql, title;
        if (filter === 'mine') {
            jql   = projectClause + 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
            title = 'Issues Assigned to You' + projectSuffix;
        } else if (filter === 'open') {
            jql   = projectClause + 'statusCategory != Done ORDER BY updated DESC';
            title = 'Open Issues' + projectSuffix;
        } else {
            jql   = projectClause + 'ORDER BY updated DESC';
            title = 'Recent Issues' + projectSuffix;
        }
        console.log('[AI Assistant] _listIssues() → JQL:', jql);
        return await _fetchAndRenderIssues(jql, title);
    }

    // ── Search issues ──────────────────────────────────────────────────────

    async function _searchIssues({ query, projectOverride }) {
        console.log('[AI Assistant] _searchIssues() → query:', query, ' projectOverride:', projectOverride);
        const resolvedProject = _resolveProject(projectOverride);
        const projectClause   = resolvedProject ? 'project = ' + resolvedProject + ' AND ' : '';
        const safe = query.replace(/"/g, '\\"');
        const jql  = projectClause + 'text ~ "' + safe + '" ORDER BY updated DESC';
        console.log('[AI Assistant] _searchIssues() → JQL:', jql);
        return await _fetchAndRenderIssues(jql, 'Results for: "' + _escHtml(query) + '"');
    }

    // ── Shared issue table renderer ────────────────────────────────────────

    async function _fetchAndRenderIssues(jql, title) {
        const url  = '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&maxResults=10&fields=summary,status,issuetype,assignee,priority';
        console.log('[AI Assistant] _fetchAndRenderIssues() → title:', title, ' url:', url);
        const resp = await _jiraFetch(url);
        console.log('[AI Assistant] _fetchAndRenderIssues() → response status:', resp.status, resp.ok ? '(ok)' : '(failed)');

        if (!resp.ok) {
            return _errorCard('Failed to fetch issues (HTTP ' + resp.status + ').');
        }

        const data   = await resp.json();
        const issues = data.issues || [];
        console.log('[AI Assistant] _fetchAndRenderIssues() → total matched:', data.total, ' returned:', issues.length);

        if (issues.length === 0) {
            return _infoCard(title, 'No issues found matching your criteria.');
        }

        const rows = issues.map(function (issue) {
            const assignee = issue.fields.assignee ? _escHtml(issue.fields.assignee.displayName) : '—';
            const catKey   = issue.fields.status.statusCategory ? issue.fields.status.statusCategory.colorName : 'blue-grey';
            const statusCss = 'ai-status-' + catKey.replace(/\s+/g, '-').toLowerCase();
            return '<tr class="ai-issue-row">'
                +  '<td><img src="' + issue.fields.issuetype.iconUrl + '" width="16" alt="' + _escHtml(issue.fields.issuetype.name) + '" title="' + _escHtml(issue.fields.issuetype.name) + '"></td>'
                +  '<td><a href="' + _ctx + '/browse/' + issue.key + '" target="_blank" class="ai-issue-link">' + issue.key + '</a></td>'
                +  '<td class="ai-issue-summary-cell" title="' + _escHtml(issue.fields.summary) + '">' + _escHtml(issue.fields.summary) + '</td>'
                +  '<td><span class="ai-status-badge ' + statusCss + '">' + _escHtml(issue.fields.status.name) + '</span></td>'
                +  '<td>' + assignee + '</td>'
                +  '</tr>';
        }).join('');

        const moreHint = data.total > 10
            ? '<div class="ai-more-hint">Showing 10 of ' + data.total + ' total issues</div>'
            : '';

        return (
            '<div class="ai-issue-list-card">'
          +   '<div class="ai-list-header">' + _escHtml(title) + ' <span class="ai-count-badge">' + data.total + '</span></div>'
          +   '<table class="ai-issues-table">'
          +     '<thead><tr><th></th><th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th></tr></thead>'
          +     '<tbody>' + rows + '</tbody>'
          +   '</table>'
          +   moreHint
          + '</div>'
        );
    }

    // ── Edit issue ─────────────────────────────────────────────────────────

    async function _editIssue({ key, field, value }) {
        console.log('[AI Assistant] _editIssue() → key:', key, ' field:', field, ' value:', value);
        const fieldLower = field.toLowerCase();
        let body = { fields: {} };

        if (fieldLower === 'summary') {
            body.fields.summary = value;
        } else if (fieldLower === 'description') {
            body.fields.description = value;
        } else if (fieldLower === 'priority') {
            body.fields.priority = { name: value };
        } else if (fieldLower === 'assignee') {
            // Look up the user by display name / username fragment
            console.log('[AI Assistant] _editIssue() → looking up user for assignee value:', value);
            const userResp = await _jiraFetch('/rest/api/2/user/search?query=' + encodeURIComponent(value) + '&maxResults=1');
            if (!userResp.ok) return _errorCard('Could not search for user "' + _escHtml(value) + '".');
            const users = await userResp.json();
            if (!Array.isArray(users) || users.length === 0) {
                console.warn('[AI Assistant] _editIssue() → no user found matching:', value);
                return _errorCard('User "' + _escHtml(value) + '" not found.');
            }
            console.log('[AI Assistant] _editIssue() → resolved user:', users[0]);
            // Jira Cloud uses accountId; Jira Server uses name
            body.fields.assignee = users[0].accountId
                ? { accountId: users[0].accountId }
                : { name: users[0].name };
        } else {
            console.warn('[AI Assistant] _editIssue() → unsupported field:', field);
            return _errorCard('Unsupported field: "' + _escHtml(field) + '". Supported: summary, description, priority, assignee.');
        }

        console.log('[AI Assistant] _editIssue() → PUT /rest/api/2/issue/' + key + ' body:', JSON.stringify(body));
        const resp = await _jiraFetch('/rest/api/2/issue/' + encodeURIComponent(key), {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
            body:    JSON.stringify(body)
        });
        console.log('[AI Assistant] _editIssue() → response status:', resp.status);

        if (resp.status === 204 || resp.ok) {
            return _successCard(
                'Issue Updated ✅',
                '<a href="' + _ctx + '/browse/' + key + '" target="_blank" class="ai-issue-link">' + key + '</a>'
                + ' — <strong>' + _escHtml(field) + '</strong> set to "' + _escHtml(value) + '"'
            );
        }

        const err = await resp.json().catch(() => ({}));
        const msg = err.errors ? Object.values(err.errors).join(', ') : resp.statusText;
        console.error('[AI Assistant] _editIssue() → update failed:', msg);
        return _errorCard('Update failed: ' + _escHtml(msg));
    }

    // ── Card templates ─────────────────────────────────────────────────────

    function _welcomeCard() {
        return (
            '<div class="ai-welcome-card">'
          +   '<div class="ai-welcome-icon">✨</div>'
          +   '<div class="ai-welcome-title">Hi! I\'m your Jira AI Assistant</div>'
          +   '<div class="ai-welcome-desc">'
          +     'I can <strong>create issues</strong>, <strong>summarize your sprint</strong>, '
          +     '<strong>list and search issues</strong>, and <strong>update fields</strong>.<br>'
          +     'Type a command below or pick a quick action above.'
          +   '</div>'
          + '</div>'
        );
    }

    function _helpCard() {
        return (
            '<div class="ai-help-card">'
          +   '<div class="ai-help-title">Here\'s what I can do for you 🤖</div>'
          +   '<div class="ai-help-commands">'
          +     _helpItem('🐛', 'create a bug for &lt;summary&gt;',      'Creates a new issue (add "in PROJ" if not on a project page)')
          +     _helpItem('📖', 'create a story for &lt;summary&gt;',    'Creates a new Story')
          +     _helpItem('🚀', 'summarize sprint',                       'Progress &amp; status breakdown of the active sprint')
          +     _helpItem('📋', 'list my open issues',                    'Issues assigned to you, optionally "in PROJ"')
          +     _helpItem('📂', 'list all open issues',                   'All open issues, optionally "in PROJ"')
          +     _helpItem('🔍', 'search for &lt;keyword&gt;',             'Full-text search, optionally "in PROJ"')
          +     _helpItem('✏️',  'update PROJ-123 priority to high',       'Edits summary / description / priority / assignee')
          +   '</div>'
          + '</div>'
        );
    }

    function _helpItem(icon, cmd, desc) {
        return (
            '<div class="ai-help-item">'
          +   '<div class="ai-help-icon">' + icon + '</div>'
          +   '<div>'
          +     '<div class="ai-help-cmd">' + cmd + '</div>'
          +     '<div class="ai-help-desc">' + desc + '</div>'
          +   '</div>'
          + '</div>'
        );
    }

    function _successCard(title, body, meta) {
        return '<div class="ai-result-card ai-result-success">'
             +   '<div class="ai-result-title">' + title + '</div>'
             +   '<div class="ai-result-body">'  + body  + '</div>'
             +   (meta ? '<div class="ai-result-meta">' + meta + '</div>' : '')
             + '</div>';
    }

    function _infoCard(title, body) {
        return '<div class="ai-result-card ai-result-info">'
             +   '<div class="ai-result-title">' + title + '</div>'
             +   '<div class="ai-result-body">'  + body  + '</div>'
             + '</div>';
    }

    function _errorCard(message) {
        return '<div class="ai-result-card ai-result-error">'
             +   '<div class="ai-result-title">⚠️ Something went wrong</div>'
             +   '<div class="ai-result-body">' + message + '</div>'
             + '</div>';
    }

    // ── Chat DOM helpers ───────────────────────────────────────────────────

    function _addUserMessage(text) {
        const el = document.createElement('div');
        el.className = 'ai-message ai-message-user';
        el.innerHTML = '<div class="ai-avatar ai-avatar-user">Me</div>'
                     + '<div class="ai-bubble ai-bubble-user">' + _escHtml(text) + '</div>';
        _appendMessage(el);
    }

    function _addBotMessage(html) {
        const el = document.createElement('div');
        el.className = 'ai-message ai-message-bot';
        el.innerHTML = '<div class="ai-avatar ai-avatar-bot">AI</div>'
                     + '<div class="ai-bubble ai-bubble-bot">' + html + '</div>';
        _appendMessage(el);
    }

    let _typingEl = null;

    function _showTyping() {
        _typingEl = document.createElement('div');
        _typingEl.className = 'ai-message ai-message-bot';
        _typingEl.innerHTML = '<div class="ai-avatar ai-avatar-bot">AI</div>'
                            + '<div class="ai-bubble ai-bubble-bot">'
                            +   '<div class="ai-typing-indicator">'
                            +     '<div class="ai-typing-dot"></div>'
                            +     '<div class="ai-typing-dot"></div>'
                            +     '<div class="ai-typing-dot"></div>'
                            +   '</div>'
                            + '</div>';
        _appendMessage(_typingEl);
    }

    function _hideTyping() {
        if (_typingEl && _typingEl.parentNode) {
            _typingEl.parentNode.removeChild(_typingEl);
        }
        _typingEl = null;
    }

    function _appendMessage(el) {
        const container = document.getElementById('ai-chat-messages');
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;
    }

    function _setBusy(busy) {
        _busy = busy;
        const btn = document.getElementById('ai-send-btn');
        if (btn) btn.disabled = busy;
    }

    // ── Fetch wrapper ──────────────────────────────────────────────────────

    function _jiraFetch(path, options) {
        const url = _ctx + path;
        const defaults = {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' }
        };
        const merged = Object.assign({}, defaults, options || {});
        if (merged.headers && options && options.headers) {
            merged.headers = Object.assign({}, defaults.headers, options.headers);
        }
        console.log('[AI Assistant] _jiraFetch() → ' + (merged.method || 'GET') + ' ' + url);
        return fetch(url, merged).then(function (resp) {
            console.log('[AI Assistant] _jiraFetch() ← ' + (merged.method || 'GET') + ' ' + url + ' → status:', resp.status);
            return resp;
        }).catch(function (err) {
            console.error('[AI Assistant] _jiraFetch() ✗ network error for ' + url + ':', err);
            throw err;
        });
    }

    // ── Utility ────────────────────────────────────────────────────────────

    function _escHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ── Context auto-detection ─────────────────────────────────────────────
    // Lets the widget work on ANY Jira page (dashboard, boards, issue navigator,
    // not just a dedicated issue action page) by reading Jira's own page meta
    // tags, falling back to parsing the URL.

    //five
    function _detectProjectKey() {
        try {
            if (typeof AJS !== 'undefined' && AJS.Meta && AJS.Meta.get) {
                const pk = AJS.Meta.get('project-key');
                if (pk) {
                    console.log('[AI Assistant] _detectProjectKey() → found via AJS.Meta("project-key"):', pk.toUpperCase());
                    return pk.toUpperCase();
                }
            }
        } catch (e) { /* ignore */ }

        const browseMatch = window.location.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]+)-\d+/);
        if (browseMatch) {
            console.log('[AI Assistant] _detectProjectKey() → found via URL /browse/ pattern:', browseMatch[1].toUpperCase());
            return browseMatch[1].toUpperCase();
        }

        const projectsMatch = window.location.pathname.match(/\/projects\/([A-Za-z][A-Za-z0-9_]+)/i);
        if (projectsMatch) {
            console.log('[AI Assistant] _detectProjectKey() → found via URL /projects/ pattern:', projectsMatch[1].toUpperCase());
            return projectsMatch[1].toUpperCase();
        }

        console.log('[AI Assistant] _detectProjectKey() → could not detect a project key on this page (path:', window.location.pathname, ')');
        return '';
    }

    //six
    function _detectIssueKey() {
        try {
            if (typeof AJS !== 'undefined' && AJS.Meta && AJS.Meta.get) {
                const ik = AJS.Meta.get('issue-key');
                if (ik) {
                    console.log('[AI Assistant] _detectIssueKey() → found via AJS.Meta("issue-key"):', ik.toUpperCase());
                    return ik.toUpperCase();
                }
            }
        } catch (e) { /* ignore */ }

        const browseMatch = window.location.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9_]+-\d+)/);
        if (browseMatch) {
            console.log('[AI Assistant] _detectIssueKey() → found via URL /browse/ pattern:', browseMatch[1].toUpperCase());
            return browseMatch[1].toUpperCase();
        }

        console.log('[AI Assistant] _detectIssueKey() → no issue key on this page');
        return '';
    }

    // ── Floating widget ─────────────────────────────────────────────────────
    // Builds the same chat markup used by the dedicated aiassistant.vm page,
    // so all existing DOM lookups (#ai-chat-messages, #ai-user-input, etc.)
    // keep working unchanged whether the assistant is embedded in a full page
    // or floating over an arbitrary Jira page.

    function _buildAssistantMarkup(projectKey, issueKey) {
        const contextBadge = projectKey
            ? '<div class="ai-context-badge" title="Current context">'
            +   '<span class="ai-context-key">' + _escHtml(issueKey || projectKey) + '</span>'
            +   '<span class="ai-context-project">' + _escHtml(projectKey) + '</span>'
            + '</div>'
            : '';

        return ''
          + '<div class="ai-header">'
          +   '<div class="ai-header-glow"></div>'
          +   '<div class="ai-header-content">'
          +     '<div class="ai-header-icon">'
          +       '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">'
          +         '<path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="white" fill-opacity="0.95"/>'
          +         '<path d="M19 15L19.8 18.2L23 19L19.8 19.8L19 23L18.2 19.8L15 19L18.2 18.2L19 15Z" fill="white" fill-opacity="0.7"/>'
          +       '</svg>'
          +     '</div>'
          +     '<div class="ai-header-text">'
          +       '<div class="ai-header-title">Jira AI Assistant</div>'
          +       '<div class="ai-header-subtitle">Ask anything — create, search, summarize</div>'
          +     '</div>'
          +     contextBadge
          +     '<button type="button" id="ai-float-close-btn" class="ai-float-close-btn" title="Close">✕</button>'
          +   '</div>'
          + '</div>'
          + '<div class="ai-chips-bar">'
          +   '<button class="ai-chip" data-prompt="Summarize sprint">🚀 Sprint Summary</button>'
          +   '<button class="ai-chip" data-prompt="List my open issues">📋 My Issues</button>'
          +   '<button class="ai-chip" data-prompt="List all open issues">📂 Open Issues</button>'
          +   '<button class="ai-chip" data-prompt="Create a story for ">📖 Create Story</button>'
          +   '<button class="ai-chip" data-prompt="Create a task for ">✅ Create Task</button>'
          +   '<button class="ai-chip" data-prompt="help">❓ Help</button>'
          + '</div>'
          + '<div id="ai-chat-messages"></div>'
          + '<div class="ai-input-bar">'
          +   '<textarea id="ai-user-input" class="ai-textarea" rows="2" '
          +     'placeholder=\'Try: "create a Story for login page crash"  •  "summarize sprint"  •  "list my issues"\'></textarea>'
          +   '<button id="ai-send-btn" class="ai-send-btn" title="Send (Enter)">'
          +     '<svg width="16" height="16" viewBox="0 0 24 24" fill="none">'
          +       '<path d="M22 2L11 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
          +       '<path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
          +     '</svg>'
          +   '</button>'
          + '</div>'
          + '<div class="ai-input-hint">Press <kbd>Enter</kbd> to send &nbsp;·&nbsp; <kbd>Shift+Enter</kbd> for new line</div>';
    }

    function _injectFloatingWidget() {
        //four
        console.log('[AI Assistant] _injectFloatingWidget() → no dedicated page markup found, building floating FAB + panel');
        const projectKey = _detectProjectKey();
        const issueKey   = _detectIssueKey();
        //seven
        console.log('[AI Assistant] _injectFloatingWidget() → detected context:', { projectKey: projectKey, issueKey: issueKey });

        const container = document.createElement('div');
        container.id = 'ai-float-container';

        const panel = document.createElement('div');
        panel.id = 'ai-float-panel';
        panel.className = 'ai-float-panel';

        const wrapper = document.createElement('div');
        wrapper.id = 'ai-assistant-wrapper';
        wrapper.className = 'ai-float-body';
        wrapper.setAttribute('data-project-key', projectKey);
        wrapper.setAttribute('data-issue-key', issueKey);
        wrapper.innerHTML = _buildAssistantMarkup(projectKey, issueKey);
        panel.appendChild(wrapper);

        const fab = document.createElement('button');
        fab.id = 'ai-fab-btn';
        fab.className = 'ai-fab-btn';
        fab.type = 'button';
        fab.title = 'Ask Jira AI Assistant';
        fab.innerHTML = '<span class="ai-fab-icon">✨</span>';

        container.appendChild(panel);
        container.appendChild(fab);
        document.body.appendChild(container);

        function togglePanel(forceOpen) {
            const isOpen     = panel.classList.contains('ai-float-panel-open');
            const shouldOpen = (typeof forceOpen === 'boolean') ? forceOpen : !isOpen;
            panel.classList.toggle('ai-float-panel-open', shouldOpen);
            fab.classList.toggle('ai-fab-btn-active', shouldOpen);
            if (shouldOpen) {
                const input = document.getElementById('ai-user-input');
                if (input) setTimeout(function () { input.focus(); }, 150);
            }
        }

        fab.addEventListener('click', function () {
            console.log('[AI Assistant] FAB button clicked → toggling panel');
            togglePanel();
        });
        const closeBtn = document.getElementById('ai-float-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', function () {
            console.log('[AI Assistant] close button clicked → closing panel');
            togglePanel(false);
        });

        //eight
        console.log('[AI Assistant] _injectFloatingWidget() → widget DOM appended to document.body, calling init()');
        init(projectKey, issueKey, (typeof AJS !== 'undefined' && AJS.contextPath) ? AJS.contextPath() : '');
    }

    // ── Boot ─────────────────────────────────────────────────────────────
    // If a dedicated aiassistant.vm page already rendered #ai-assistant-wrapper
    // server-side, use it as-is. Otherwise (any other Jira page) inject the
    // floating widget so the assistant is available everywhere.

    function _boot() {
        //two
        console.log('[AI Assistant] _boot() → checking for a dedicated #ai-assistant-wrapper element on this page');
        const existingWrapper = document.getElementById('ai-assistant-wrapper');
        if (existingWrapper) {
            console.log('[AI Assistant] _boot() → found dedicated page wrapper, using server-rendered markup');
            const projectKey = existingWrapper.getAttribute('data-project-key');
            const issueKey   = existingWrapper.getAttribute('data-issue-key');
            const ctxPath    = (typeof AJS !== 'undefined' && AJS.contextPath) ? AJS.contextPath() : '';
            console.log('[AI Assistant] _boot() → data attributes:', { projectKey: projectKey, issueKey: issueKey, ctxPath: ctxPath });
            init(projectKey, issueKey, ctxPath);
            return;
        }
        //three
        console.log('[AI Assistant] _boot() → no dedicated wrapper found, injecting floating widget');
        _injectFloatingWidget();
    }

    // ── Public API ─────────────────────────────────────────────────────────

    return { init: init, boot: _boot };

})();

// ── Self-initialization ─────────────────────────────────────────────────────
// This resource is loaded on every Jira page (jira.general context). We don't
// call JiraAI.boot() from an inline <script> because Jira loads plugin JS
// resources asynchronously via its Web Resource Manager batch loader, so an
// inline script executed at parse-time could run before this file finishes
// loading. Booting from inside this file avoids that race, since jQuery's
// ready() fires immediately if the DOM is already parsed.
(function () {
    function run() {
        // one
        console.log('[AI Assistant] self-init run() → attempting JiraAI.boot()');
        if (typeof JiraAI !== 'undefined' && JiraAI.boot) {
            JiraAI.boot();
        } else {
            console.error('[AI Assistant] self-init run() → JiraAI is not defined or has no boot() method!');
        }
    }

    if (typeof AJS !== 'undefined' && AJS.$) {
        console.log('[AI Assistant] self-init → AJS.$ available, scheduling run() via AJS.$(run)');
        AJS.$(run);
    } else if (document.readyState === 'loading') {
        console.log('[AI Assistant] self-init → document still loading, waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', run);
    } else {
        console.log('[AI Assistant] self-init → DOM already ready, running immediately');
        run();
    }
})();
