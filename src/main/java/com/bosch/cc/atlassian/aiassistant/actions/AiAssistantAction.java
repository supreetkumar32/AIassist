package com.bosch.cc.atlassian.aiassistant.actions;

import com.atlassian.jira.issue.Issue;
import com.atlassian.jira.security.request.RequestMethod;
import com.atlassian.jira.security.request.SupportedMethods;
import com.atlassian.jira.web.action.JiraWebActionSupport;
import com.bosch.cc.atlassian.aiassistant.util.JiraUtil;

/**
 * WebWork action that renders the AI Assistant chat page.
 * Exposes current issue context (projectKey, issueKey, issueSummary) to the
 * Velocity template so the JavaScript layer can use them without extra REST calls.
 */
public class AiAssistantAction extends JiraWebActionSupport {

    private Long issueId;
    private String projectKey;
    private String issueKey;
    private String issueSummary;

    // ── Getters / Setters ──────────────────────────────────────────────────

    public Long getIssueId() {
        return issueId;
    }

    public void setIssueId(Long issueId) {
        this.issueId = issueId;
    }

    public String getProjectKey() {
        return projectKey;
    }

    public String getIssueKey() {
        return issueKey;
    }

    public String getIssueSummary() {
        return issueSummary;
    }

    // ── Action ────────────────────────────────────────────────────────────

    @Override
    @SupportedMethods({RequestMethod.GET})
    public String doDefault() throws Exception {
        Issue issue = JiraUtil.getIssueForId(issueId);
        if (issue != null) {
            projectKey   = issue.getProjectObject().getKey();
            issueKey     = issue.getKey();
            issueSummary = issue.getSummary();
        }
        return SUCCESS;
    }
}
