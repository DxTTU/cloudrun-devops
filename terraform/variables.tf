variable "project_id" {
  description = "GCP project ID (e.g. my-project-123456). No default — you must supply it."
  type        = string
}

variable "region" {
  description = "GCP region for all resources."
  type        = string
  default     = "asia-south1" # Mumbai — closest to India, keeps latency low
}

variable "service_name" {
  description = "Cloud Run service name (also used for the Artifact Registry repo)."
  type        = string
  default     = "snip-api"
}

variable "image_tag" {
  description = "Docker image tag to deploy. CI passes the commit SHA; defaults to latest for manual runs."
  type        = string
  default     = "latest"
}
