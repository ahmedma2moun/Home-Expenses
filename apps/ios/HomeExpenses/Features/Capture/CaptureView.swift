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
                Task {
                    if let created = await viewModel.analyze() {
                        onReceiptCreated(created)
                    }
                }
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
    }
}

#Preview {
    NavigationStack {
        CaptureView(onReceiptCreated: { (_: CreatedReceipt) in })
    }
}
