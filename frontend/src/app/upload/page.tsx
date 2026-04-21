"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

const categories = [
  {
    id: "general",
    label: "일반화장품",
    desc: "스킨케어 · 메이크업 · 헤어",
    icon: "🧴",
    productType: "general_cosmetic",
  },
  {
    id: "functional",
    label: "기능성화장품",
    desc: "미백 · 주름 · 자외선차단",
    icon: "✨",
    productType: "functional_cosmetic",
  },
];

function Stepper({ current }: { current: number }) {
  const steps = ["제품 유형 선택", "내용 입력", "분석 시작"];

  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((label, i) => {
        const idx = i + 1;
        const isDone = current > idx;
        const isActive = current === idx;

        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200
                  ${
                    isDone
                      ? "bg-blue-600 text-white"
                      : isActive
                        ? "bg-blue-600 text-white ring-4 ring-blue-100"
                        : "bg-gray-100 text-gray-400"
                  }`}
              >
                {isDone ? "✓" : idx}
              </div>

              <span
                className={`mt-1.5 text-xs font-medium whitespace-nowrap ${
                  isActive || isDone ? "text-blue-600" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div
                className={`w-20 h-0.5 mb-5 mx-1 transition-all duration-200 ${
                  current > idx ? "bg-blue-600" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [ocrPreview, setOcrPreview] = useState("");

  // ── 동적 높이 조절 ──────────────────────────────────────────
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  // ── 이미지 미리보기 URL ─────────────────────────────────────
  const createPreview = (targetFile: File) => {
    if (targetFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(targetFile);
      setImagePreviewUrl(url);
    } else {
      setImagePreviewUrl(null);
    }
  };

  const clearPreview = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
  };

  const validateFile = (targetFile: File) => {
    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "application/pdf",
    ];

    if (!allowedTypes.includes(targetFile.type)) {
      alert("PNG, JPG, JPEG, PDF 파일만 업로드 가능합니다.");
      return false;
    }

    return true;
  };

  // ── 파일 선택 (텍스트와 동시 허용 — setText 초기화 제거) ───
  const handleFileSelect = (targetFile: File | null) => {
    if (!targetFile) return;
    if (!validateFile(targetFile)) return;

    clearPreview();
    setFile(targetFile);
    createPreview(targetFile);
    setOcrPreview("");
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      handleFileSelect(dropped);
    }
  };

  const analyzeOCR = async (targetFile: File) => {
    setLoadingStatus("이미지에서 텍스트를 추출하고 있습니다...");

    const formData = new FormData();
    formData.append("file", targetFile);

    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "OCR 요청 실패");
    }

    return data.text as string;
  };

  const handleAnalyze = async () => {
    if (!selectedCategory) {
      alert("제품 유형을 선택하세요.");
      return;
    }

    if (!text.trim() && !file) {
      alert("텍스트를 입력하거나 파일을 업로드하세요.");
      return;
    }

    if (!agreed) {
      alert("분석 데이터 처리 방침에 동의해주세요.");
      return;
    }

    const category = categories.find((c) => c.id === selectedCategory);
    const productType = category?.productType ?? "general_cosmetic";

    // ── [분기 1] 파일이 있는데 아직 OCR을 실행하지 않은 경우 ──
    // OCR만 먼저 실행하고 결과 미리보기를 보여준 뒤 여기서 멈춘다.
    // 사용자가 OCR 결과를 확인하고 버튼을 다시 눌러야 실제 분석으로 넘어감.
    if (file && !ocrPreview) {
      setLoading(true);
      try {
        const ocrText = await analyzeOCR(file);
        setOcrPreview(ocrText);
      } catch (error: any) {
        console.error("상세 에러 내역:", error);
        alert(
          `OCR 분석 중 오류가 발생했습니다: ${error?.message || "알 수 없는 오류"}`,
        );
      } finally {
        setLoading(false);
        setLoadingStatus("");
      }
      return;
    }

    // ── [분기 2] 실제 분석 단계로 진입 ──
    // - 파일 있음 + OCR 완료: OCR 텍스트만 전송
    // - 파일 없음: 사용자가 입력한 텍스트 전송
    let finalContent = "";
    if (file && ocrPreview) {
      finalContent = ocrPreview;
    } else {
      finalContent = text.trim();
    }

    if (!finalContent) {
      alert("분석할 내용이 없습니다.");
      return;
    }

    setLoading(true);
    setLoadingStatus("분석 페이지로 이동 중...");
    try {
      // 실제 분석은 /result 페이지에서 SSE(/api/analyze-stream)로 진행 (L1~L5 단계별 로딩 화면 표시)
      // 이전 결과가 남아있으면 제거하여 stale 결과 방지
      localStorage.removeItem("adguard_result");
      sessionStorage.setItem("analyzeText", finalContent);
      sessionStorage.setItem("analyzeProductType", productType);

      router.push("/result");
    } catch (error: any) {
      console.error("상세 에러 내역:", error);
      alert(
        `분석 준비 중 오류가 발생했습니다: ${error?.message || "알 수 없는 오류"}`,
      );
      setLoading(false);
      setLoadingStatus("");
    }
  };

  const isReady = !!selectedCategory && (!!text.trim() || !!file) && agreed;
  const currentStep = !selectedCategory ? 1 : !(text.trim() || file) ? 2 : 3;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-4xl">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-400 mb-5 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Azure AI 기반 광고 컴플라이언스 도구
          </div>

          <h1 className="text-4xl font-extrabold text-gray-900 mb-2 tracking-tight">
            광고청정기
          </h1>

          <p className="text-gray-500 text-base">
            광고 문구를 입력하거나 파일을 업로드하면 위반 여부를 분석해드려요.
          </p>
        </div>

        <Stepper current={currentStep} />

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* ── 좌측: 제품 유형 + 텍스트 입력 ── */}
            <div className="space-y-6">
              {/* 제품 유형 선택 */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  제품 유형 선택 <span className="text-blue-500">*</span>
                </p>

                <div className="grid grid-cols-1 gap-3">
                  {categories.map((cat) => {
                    const isSelected = selectedCategory === cat.id;

                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`group flex items-center gap-3 w-full p-3 rounded-xl border-2 text-left transition-all duration-150
                          ${
                            isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-100 bg-gray-50 hover:border-blue-200 hover:bg-blue-50/40"
                          }`}
                      >
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all duration-150
                            ${isSelected ? "bg-blue-100" : "bg-gray-100 group-hover:bg-blue-100"}`}
                        >
                          {cat.icon}
                        </div>

                        <div className="flex-1">
                          <div
                            className={`text-sm font-bold transition-colors ${
                              isSelected ? "text-blue-700" : "text-gray-800"
                            }`}
                          >
                            {cat.label}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {cat.desc}
                          </div>
                        </div>

                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                            ✓
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 텍스트 직접 입력 — 카테고리 2개로 공백 생겨 영역 키움 */}
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  텍스트 직접 입력
                </p>

                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    autoResize();
                  }}
                  placeholder="광고 문구를 입력하세요&#10;예) 단 1회만에 피부 30% 개선 보장!"
                  style={{ minHeight: "160px", resize: "none", overflow: "hidden" }}
                  className="w-full p-4 rounded-xl border border-gray-200 text-sm transition-all focus:outline-none focus:border-blue-400 bg-gray-50 text-gray-700 focus:bg-white"
                />

                {text && (
                  <p className="text-xs text-gray-300 mt-1 text-right">
                    {text.length}자
                  </p>
                )}
              </div>
            </div>

            {/* ── 우측: 파일 업로드 + 동의 + 버튼 ── */}
            <div className="flex flex-col gap-5">
              {/* 파일 업로드 */}
              <div className="flex-1">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-gray-700">
                    파일 업로드
                  </p>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    PNG · JPG · PDF
                  </span>
                </div>

                <div
                  onClick={() => {
                    if (!file) fileInputRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                  }}
                  onDrop={handleDrop}
                  className={`relative rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-200 cursor-pointer
                    ${
                      isDragging
                        ? "border-blue-500 bg-blue-50 scale-[1.01] shadow-md"
                        : file
                          ? "border-blue-300 bg-blue-50/50"
                          : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
                    }`}
                  style={{ minHeight: "200px" }}
                >
                  {/* 드래그 오버레이 애니메이션 */}
                  {isDragging && (
                    <div className="absolute inset-0 rounded-2xl bg-blue-100/40 animate-pulse pointer-events-none" />
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".png,.jpg,.jpeg,.pdf"
                    onChange={(e) => {
                      const selected = e.target.files?.[0] || null;
                      handleFileSelect(selected);
                    }}
                  />

                  {file ? (
                    <div className="text-center space-y-3 px-4 py-4 w-full">
                      {/* 이미지 썸네일 or PDF 아이콘 */}
                      {imagePreviewUrl ? (
                        <div className="mx-auto w-32 h-20 rounded-xl overflow-hidden border border-blue-200 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imagePreviewUrl}
                            alt="미리보기"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-3xl mx-auto">
                          📋
                        </div>
                      )}

                      <div>
                        <p className="text-sm text-gray-700 font-semibold max-w-[200px] truncate mx-auto">
                          {file.name}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>

                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          className="text-xs text-blue-500 hover:text-blue-600 underline"
                        >
                          파일 변경
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearPreview();
                            setFile(null);
                            setOcrPreview("");
                            if (fileInputRef.current) {
                              fileInputRef.current.value = "";
                            }
                          }}
                          className="text-xs text-red-400 hover:text-red-500 underline"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-3 px-6 py-6">
                      <div
                        className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mx-auto transition-all duration-200 ${
                          isDragging ? "bg-blue-200 scale-110" : "bg-gray-100"
                        }`}
                      >
                        {isDragging ? "📂" : "⬆"}
                      </div>

                      <p className="text-sm text-gray-600 font-medium">
                        {isDragging
                          ? "여기에 놓으세요!"
                          : "이미지 · PDF 드래그 또는 클릭"}
                      </p>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                      >
                        파일 선택
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* OCR 미리보기 */}
              {ocrPreview && (
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
                  <p className="text-sm font-semibold text-gray-700 mb-2">
                    OCR 결과 미리보기
                  </p>
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words">
                    {ocrPreview}
                  </pre>
                </div>
              )}

              {/* 분석 데이터 안내 + 동의 체크박스 + 버튼 */}
              <div className="space-y-3">
                {/* 안내 문구 */}
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="text-xs">⚠️</span>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    분석 데이터는 Azure AI를 통해 처리되며 법적 효력이 없습니다.
                  </p>
                </div>

                {/* 분석 데이터 동의 체크박스 */}
                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <div className="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150
                        ${agreed ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300 group-hover:border-blue-400"}`}
                    >
                      {agreed && (
                        <svg
                          className="w-2.5 h-2.5 text-white"
                          viewBox="0 0 10 10"
                          fill="none"
                        >
                          <path
                            d="M1.5 5L4 7.5L8.5 2.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    <span className="text-blue-500 font-semibold">[필수]</span>{" "}
                    입력하신 광고 문구는 분석 목적으로만 사용되며, AI
                    14일 내에 파기됩니다. 수정안에 대한 👍👎 피드백은
                    서비스 품질 개선에 활용될 수 있습니다.
                  </p>
                </label>

                {/* 분석 시작 버튼 */}
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!isReady || loading}
                  className={`w-full py-4 rounded-xl text-sm font-bold transition-all duration-150 flex items-center justify-center gap-2
                    ${
                      isReady && !loading
                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                        : "bg-gray-100 text-gray-300 cursor-not-allowed"
                    }`}
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {loadingStatus}
                    </>
                  ) : file && !ocrPreview ? (
                    "OCR 분석 시작 →"
                  ) : file && ocrPreview ? (
                    "이 텍스트로 광고 분석 시작 →"
                  ) : (
                    "광고 분석 시작 →"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
