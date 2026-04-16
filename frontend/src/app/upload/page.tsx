"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const categories = [
  {
    id: "general",
    label: "일반화장품",
    desc: "스킨케어 · 메이크업 · 헤어",
    icon: "🧴",
  },
  {
    id: "functional",
    label: "기능성화장품",
    desc: "미백 · 주름 · 자외선차단",
    icon: "✨",
  },
  {
    id: "quasi",
    label: "의약외품",
    desc: "치약 · 구강청결제 · 파스",
    icon: "💊",
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

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [ocrPreview, setOcrPreview] = useState("");

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

  const handleFileSelect = (targetFile: File | null) => {
    if (!targetFile) return;
    if (!validateFile(targetFile)) return;

    setFile(targetFile);
    setText("");
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

    setLoading(true);

    try {
      let finalContent = text.trim();

      if (file) {
        const ocrText = await analyzeOCR(file);
        finalContent = ocrText;
        setOcrPreview(ocrText);
      }

      setLoadingStatus("표시광고법 위반 여부를 분석 중입니다...");

      console.log("분석 대상 카테고리:", selectedCategory);
      console.log("분석 대상 텍스트:", finalContent);

      // TODO: 실제 분석 API 연결
      // const res = await fetch("/api/analyze", { ... })

      // 테스트 중이면 우선 결과 페이지 이동 대신 콘솔/OCR 미리보기 확인
      router.push("/result");
    } catch (error) {
      console.error(error);
      alert("분석 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  };

  const isReady = !!selectedCategory && (!!text.trim() || !!file);
  const currentStep = !selectedCategory ? 1 : !(text.trim() || file) ? 2 : 3;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-4xl">
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
            {/* 좌측 영역 */}
            <div className="space-y-6">
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
                        className={`p-4 rounded-2xl border-2 text-left transition-all duration-150 flex items-center gap-4 group
                          ${
                            isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-100 hover:border-blue-200 hover:bg-blue-50/40"
                          }`}
                      >
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all duration-150
                            ${
                              isSelected
                                ? "bg-blue-100"
                                : "bg-gray-100 group-hover:bg-blue-100"
                            }`}
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

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  텍스트 직접 입력
                </p>

                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (e.target.value.trim()) {
                      setFile(null);
                      setOcrPreview("");
                    }
                  }}
                  disabled={!!file}
                  placeholder={
                    file
                      ? "파일 분석 모드입니다."
                      : "광고 문구를 입력하세요\n예) 단 1회만에 피부 30% 개선 보장!"
                  }
                  className={`w-full h-32 p-4 rounded-xl border border-gray-200 text-sm transition-all resize-none focus:outline-none focus:border-blue-400
                    ${
                      file
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-gray-50 text-gray-700 focus:bg-white"
                    }`}
                />

                {text && (
                  <p className="text-xs text-gray-300 mt-1 text-right">
                    {text.length}자
                  </p>
                )}
              </div>
            </div>

            {/* 우측 영역 */}
            <div className="flex flex-col gap-6">
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
                    if (!file) {
                      fileInputRef.current?.click();
                    }
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
                  className={`relative h-64 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-200 cursor-pointer
                    ${
                      isDragging
                        ? "border-blue-500 bg-blue-50"
                        : file
                          ? "border-blue-300 bg-blue-50/50"
                          : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
                    }`}
                >
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
                    <div className="text-center space-y-3 px-4">
                      <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center text-3xl mx-auto">
                        {file.type === "application/pdf" ? "📋" : "🖼️"}
                      </div>

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
                    <div className="text-center space-y-3 px-6">
                      <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center text-3xl mx-auto">
                        ⬆
                      </div>

                      <p className="text-sm text-gray-600 font-medium">
                        이미지 · PDF 드래그 또는 클릭
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

              <div className="space-y-3">
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="text-xs">⚠️</span>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    분석 데이터는 Azure AI를 통해 처리되며 법적 효력이 없습니다.
                  </p>
                </div>

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
