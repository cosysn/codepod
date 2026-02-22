package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "envbuilder",
	Short: "Build devcontainer images without Docker",
}

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build devcontainer image",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("envbuilder build started")
	},
}

func main() {
	rootCmd.AddCommand(buildCmd)
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
