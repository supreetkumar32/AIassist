package com.bosch.cc.atlassian.aiassistant.rest;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * Proxies chat requests from the browser to the Python Google-ADK agent
 * service (see /ai-agent-service). Keeping this hop server-side avoids CORS
 * issues and keeps the agent service off the public network.
 *
 * The request/response bodies are passed through as-is (raw JSON) — the
 * agent service owns the JSON contract, so this resource has no coupling to
 * its shape and needs no JSON library dependency.
 */
@Path("/chat")
public class AiAgentChatResource {

    private static final String DEFAULT_AGENT_SERVICE_URL = "http://localhost:8000";
    private static final int BAD_GATEWAY_STATUS = 502;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response chat(String requestBody) {
        String agentServiceUrl = resolveAgentServiceUrl() + "/chat";

        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(agentServiceUrl))
                    .timeout(Duration.ofSeconds(30))
                    .header("Content-Type", MediaType.APPLICATION_JSON)
                    .POST(HttpRequest.BodyPublishers.ofString(requestBody == null ? "{}" : requestBody))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            return Response.status(response.statusCode())
                    .type(MediaType.APPLICATION_JSON)
                    .entity(response.body())
                    .build();
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            String errorJson = "{\"status\":\"error\",\"action\":\"chat\","
                    + "\"error_message\":\"AI agent service is unavailable.\"}";
                return Response.status(BAD_GATEWAY_STATUS)
                    .type(MediaType.APPLICATION_JSON)
                    .entity(errorJson)
                    .build();
        }
    }

    private String resolveAgentServiceUrl() {
        String fromProperty = System.getProperty("ai.agent.service.url");
        if (fromProperty != null && !fromProperty.isBlank()) {
            return stripTrailingSlash(fromProperty);
        }
        String fromEnv = System.getenv("AI_AGENT_SERVICE_URL");
        if (fromEnv != null && !fromEnv.isBlank()) {
            return stripTrailingSlash(fromEnv);
        }
        return DEFAULT_AGENT_SERVICE_URL;
    }

    private String stripTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
