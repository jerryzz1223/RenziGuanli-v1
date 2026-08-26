import { toast } from "frappe-ui"

export function useDownloadPDF(translate = (value) => value) {
	async function downloadPDF({ doctype, docname, filename = null }) {
		const t = typeof translate === "function" ? translate : (value) => value
		const headers = {
			"X-Frappe-Site-Name": window.location.hostname,
		}
		if (window.csrf_token) {
			headers["X-Frappe-CSRF-Token"] = window.csrf_token
		}

		try {
			const response = await fetch("/api/method/hrms.api._download_pdf", {
				method: "POST",
				headers,
				body: new URLSearchParams({ doctype, docname }),
				responseType: "blob",
			})

			if (!response.ok) {
				toast({
					title: t("Download Failed"),
					text: t("Error downloading PDF"),
					type: "error",
					icon: "alert-circle",
					position: "bottom-center",
					iconClasses: "text-red-500",
				})
				return
			}

			const blob = await response.blob()
			const blobUrl = window.URL.createObjectURL(blob)
			const link = document.createElement("a")
			link.href = blobUrl
			link.download = `${filename || docname}.pdf`
			link.click()
			setTimeout(() => {
				window.URL.revokeObjectURL(blobUrl)
			}, 3000)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			toast({
				title: t("Error"),
				text: `${t("Error downloading PDF")}: ${errorMessage}`,
				type: "error",
				icon: "alert-circle",
				position: "bottom-center",
				iconClasses: "text-red-500",
			})
		}
	}

	return {
		downloadPDF,
	}
}
