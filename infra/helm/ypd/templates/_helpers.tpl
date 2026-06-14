{{/* ----------------------------------------------------------------- Names */}}
{{- define "ypd.name" -}}
{{- default "ypd" .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ypd.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Per-component object name, e.g. "ypd-backend-api". Arg: (list $ "backend-api") */}}
{{- define "ypd.componentName" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{- printf "%s-%s" (include "ypd.fullname" $root) $component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* ----------------------------------------------------------------- Labels */}}
{{/* Full labels. Arg: (list $ "backend-api") */}}
{{- define "ypd.labels" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
helm.sh/chart: {{ printf "%s-%s" $root.Chart.Name $root.Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ $component }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
app.kubernetes.io/part-of: ypd
app.kubernetes.io/managed-by: {{ $root.Release.Service }}
app.kubernetes.io/version: {{ $root.Values.global.imageTag | quote }}
{{- end -}}

{{/* Selector labels (stable subset). Arg: (list $ "backend-api") */}}
{{- define "ypd.selectorLabels" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
app.kubernetes.io/name: {{ $component }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
{{- end -}}

{{/* ----------------------------------------------------------------- Images */}}
{{/* GHCR image for a first-party component. Arg: (list $ "ypd-backend") */}}
{{- define "ypd.image" -}}
{{- $root := index . 0 -}}
{{- $name := index . 1 -}}
{{- printf "%s/%s:%s" $root.Values.global.registry $name $root.Values.global.imageTag -}}
{{- end -}}

{{/* ----------------------------------------------------------------- Service account */}}
{{/* Each workload class gets its own SA. Arg: (list $ "backend") */}}
{{- define "ypd.serviceAccountName" -}}
{{- $root := index . 0 -}}
{{- $class := index . 1 -}}
{{- printf "%s-%s" (include "ypd.fullname" $root) $class | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* ----------------------------------------------------------------- Secret names (existingSecret) */}}
{{- define "ypd.backendSecretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-backend-secrets" (include "ypd.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "ypd.workerSecretName" -}}
{{- if .Values.secrets.existingSecretWorker -}}
{{- .Values.secrets.existingSecretWorker -}}
{{- else if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-worker-secrets" (include "ypd.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* ----------------------------------------------------------------- In-cluster dep service names */}}
{{- define "ypd.valkeyName" -}}{{ printf "%s-valkey" (include "ypd.fullname" .) }}{{- end -}}
{{- define "ypd.valkeyQueueName" -}}{{ printf "%s-valkey-queue" (include "ypd.fullname" .) }}{{- end -}}
{{- define "ypd.valkeyEphemeralName" -}}{{ printf "%s-valkey-ephemeral" (include "ypd.fullname" .) }}{{- end -}}
{{- define "ypd.postgresName" -}}{{ printf "%s-postgres" (include "ypd.fullname" .) }}{{- end -}}
{{- define "ypd.seaweedfsName" -}}{{ printf "%s-seaweedfs" (include "ypd.fullname" .) }}{{- end -}}

{{/* Non-secret S3 endpoint: in-cluster SeaweedFS Service, or the external endpoint from values. */}}
{{- define "ypd.s3Endpoint" -}}
{{- if .Values.seaweedfs.inCluster -}}
{{- printf "http://%s:8333" (include "ypd.seaweedfsName" .) -}}
{{- else -}}
{{- required "config.s3.endpoint is required when seaweedfs.inCluster=false" .Values.config.s3.endpoint -}}
{{- end -}}
{{- end -}}

{{/* The OAuth redirect URI (public, ConfigMap). Derived from the ingress host unless overridden. */}}
{{- define "ypd.googleRedirectUri" -}}
{{- if .Values.google.redirectUri -}}
{{- .Values.google.redirectUri -}}
{{- else -}}
{{- printf "https://%s/api/auth/google/callback" (required "ingress.host is required when google.enabled=true" .Values.ingress.host) -}}
{{- end -}}
{{- end -}}

{{/* ----------------------------------------------------------------- securityContext */}}
{{/* Pod-level. Arg: (list $ <uid|"">). Empty uid: rely on image's numeric USER. */}}
{{- define "ypd.podSecurityContext" -}}
{{- $uid := index . 1 -}}
{{- if $uid }}
runAsNonRoot: true
runAsUser: {{ $uid }}
runAsGroup: {{ $uid }}
fsGroup: {{ $uid }}
{{- end }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Container-level. Arg: (list $ <readOnlyRootFilesystem bool>). */}}
{{- define "ypd.containerSecurityContext" -}}
{{- $ro := index . 1 -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: {{ $ro }}
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* ----------------------------------------------------------------- CPU HorizontalPodAutoscaler */}}
{{/* Stock CPU HPA shared by the stateless tiers. Arg: (list $ "<component>" <autoscaling-values>). */}}
{{- define "ypd.hpa" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{- $as := index . 2 -}}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "ypd.componentName" (list $root $component) }}
  labels:
    {{- include "ypd.labels" (list $root $component) | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "ypd.componentName" (list $root $component) }}
  minReplicas: {{ $as.minReplicas }}
  maxReplicas: {{ $as.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $as.targetCPUUtilizationPercentage }}
{{- end -}}
