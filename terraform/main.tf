# ---------------------------------------------------------------------------
# snip-api on GCP — all infrastructure as code.
# Artifact Registry (image store) -> Cloud Run (serverless containers)
#   -> Cloud Monitoring (uptime check + alert).
# ---------------------------------------------------------------------------

# Private Docker registry for our images
resource "google_artifact_registry_repository" "repo" {
  project       = var.project_id
  location      = var.region
  repository_id = "${var.service_name}-repo"
  description   = "Docker images for ${var.service_name} (managed by Terraform)"
  format        = "DOCKER"
}

# Serverless containers — scales to zero, so idle time costs nothing
resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.repo.repository_id}/${var.service_name}:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name  = "PORT"
        value = "8080"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # Cloud Run probes these endpoints to know the container is alive
      startup_probe {
        http_get {
          path = "/healthz"
        }
      }

      liveness_probe {
        http_get {
          path = "/healthz"
        }
      }
    }

    scaling {
      min_instance_count = 0 # scale to zero = no idle cost
      max_instance_count = 3
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [google_artifact_registry_repository.repo]
}

# Public demo API — anyone can call it
resource "google_cloud_run_v2_service_iam_binding" "public_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  members  = ["allUsers"]
}

# Uptime check against /healthz, every 5 minutes, from multiple regions
resource "google_monitoring_uptime_check_config" "api" {
  project      = var.project_id
  display_name = "${var.service_name} uptime"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/healthz"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
    }
  }
}

# Alert policy: fire when the uptime check fails for 5 minutes
resource "google_monitoring_alert_policy" "api_down" {
  project      = var.project_id
  display_name = "${var.service_name} is down"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }

  # Attach notification channels (email/Slack/PagerDuty) in the Cloud Console,
  # or add a google_monitoring_notification_channel resource and its ID here.
  notification_channels = []
}
