package com.bosch.cc.atlassian.aiassistant.util;

import com.atlassian.jira.component.ComponentAccessor;
import com.atlassian.jira.issue.Issue;
import com.atlassian.jira.issue.IssueManager;

public class JiraUtil {

  private JiraUtil() {
    throw new IllegalStateException("Utility class cannot be instantiated");
  }

  public static IssueManager getIssueManager() {
    return ComponentAccessor.getIssueManager();
  }

  public static Issue getIssueForId(Long id) {
    return getIssueManager().getIssueObject(id);
  }
}
