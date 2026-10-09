import PhotosUI
import SwiftUI

/// Photo picker with reorderable thumbnails; "Analyze" uploads and starts the parse
/// (PROJECT_SPEC.md §10, screen 2).
struct CaptureView: View {
    @StateObject private var viewModel = CaptureViewModel()
    var onReceiptCreated: (CreatedReceipt) -> Void

    var body: some View {
        VStack(spacing: 16) {
            if viewModel.thumbnails.isEmpty {
                ContentUnavailableView(
                    "Add a receipt",
                    systemImage: "camera",
                    description: Text("Pick one or more screenshots or photos of your receipt.")
                )
            } else {
                List {
                    ForEach(viewModel.thumbnails) { thumbnail in
                        HStack {
                            Image(uiImage: thumbnail.uiImage)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 60, height: 60)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Spacer()
                            Button(role: .destructive) {
                                viewModel.remove(thumbnail)
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove photo")
                        }
                    }
                    .onMove(perform: viewModel.move)
                }
            }

            if !viewModel.thumbnails.isEmpty {
                ExtractionModePicker(
                    mode: $viewModel.extractionMode,
                    availability: viewModel.onDeviceAvailability
                )
                .padding(.horizontal)
            }

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .padding(.horizontal)
            }

            PhotosPicker(
                selection: $viewModel.selectedItems,
                maxSelectionCount: 6,
                matching: .images
            ) {
                Label("Choose photos", systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.bordered)

            Button {
                viewModel.startAnalyzing(onCreated: onReceiptCreated)
            } label: {
                if viewModel.isAnalyzing {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Analyze")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!viewModel.canAnalyze)
            .padding(.horizontal)
        }
        .padding(.vertical)
        .navigationTitle("Add Receipt")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
            }
        }
        // On-device analysis (model generation) can run for several seconds — if the user
        // backs out of this screen mid-run, nothing else would otherwise stop it.
        .onDisappear { viewModel.cancelAnalyzing() }
    }
}

/// Two-segment choice between cloud and on-device extraction. Not a native `.segmented` `Picker`:
/// SwiftUI gives no way to disable a single segment inside one, and disabling/dimming just the
/// on-device option (not hiding it) on an Apple Intelligence-incapable device is the whole point.
private struct ExtractionModePicker: View {
    @Binding var mode: ExtractionMode
    let availability: OnDeviceAvailability

    private var unavailableReason: String? {
        if case .unavailable(let reason) = availability { return reason }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                // Neither subtitle names a vendor: the cloud provider is a server-side config
                // (AI_PROVIDER.md — Gemini today, but swappable), and "Private" would overclaim for
                // on-device — the images still upload for `ReceiptImage` bookkeeping either way
                // (BR-1), they just aren't sent to an AI provider for parsing.
                segment(
                    title: "Cloud",
                    subtitle: "Sent to AI provider",
                    value: .cloud,
                    enabled: true,
                    disabledReason: nil
                )
                segment(
                    title: "On This iPhone",
                    subtitle: "Not sent to AI provider",
                    value: .onDevice,
                    enabled: availability.isAvailable,
                    disabledReason: unavailableReason
                )
            }
            if let unavailableReason {
                Text(unavailableReason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func segment(
        title: String,
        subtitle: String,
        value: ExtractionMode,
        enabled: Bool,
        disabledReason: String?
    ) -> some View {
        let isSelected = mode == value
        Button {
            mode = value
        } label: {
            VStack(spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(
                isSelected ? Color.accentColor.opacity(0.15) : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(Color.secondary.opacity(0.3))
            )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint(Text(disabledReason ?? ""))
    }
}

#Preview {
    NavigationStack {
        CaptureView(onReceiptCreated: { (_: CreatedReceipt) in })
    }
}
