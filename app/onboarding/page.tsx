"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Onboarding() {
  const [role, setRole] = useState("");
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // ✅ Get role
  useEffect(() => {
    const getRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data, error } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (error) console.error(error);

      setRole(data?.role);
    };

    getRole();
  }, []);

  // ✅ Submit
  const handleSubmit = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { error: userError } = await supabase
      .from("users")
      .update({
        first_name: form.first_name,
        last_name: form.last_name,
      })
      .eq("id", user.id);

    if (userError) console.error(userError);

    if (role === "doctor") {
      await supabase
        .from("doctors")
        .update({
          education: form.education,
          specialization: form.specialization,
          experience: Number(form.experience),
        })
        .eq("id", user.id);
    } else if (role === "patient") {
      await supabase
        .from("patients")
        .update({
          age: Number(form.age),
          disease: form.disease,
          gender: form.gender,
        })
        .eq("id", user.id);
    }

    setLoading(false);
    router.push("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">

      {/* MAIN CONTAINER */}
      <div className="w-full max-w-md space-y-6">

        {/* HEADING */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Physiotherapy Guidance System
          </h1>
          <p className="text-sm text-muted-foreground">
            Smart exercise tracking & recovery support
          </p>
        </div>

        {/* CARD */}
        <Card className="shadow-xl rounded-2xl">
          <CardHeader>
            <CardTitle className="text-center text-2xl font-semibold">
              Complete Your Profile
            </CardTitle>
            <p className="text-center text-sm text-muted-foreground">
              Please fill in your details to continue
            </p>
          </CardHeader>

          <CardContent className="space-y-5">

            {/* FIRST NAME */}
            <div className="space-y-2">
              <label className="text-sm font-medium">First Name</label>
              <Input
                placeholder="Enter your first name"
                onChange={(e) =>
                  setForm({ ...form, first_name: e.target.value })
                }
              />
            </div>

            {/* LAST NAME */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Last Name</label>
              <Input
                placeholder="Enter your last name"
                onChange={(e) =>
                  setForm({ ...form, last_name: e.target.value })
                }
              />
            </div>

            {/* DOCTOR FORM */}
            {role === "doctor" && (
              <>
                <Input
                  placeholder="Education"
                  onChange={(e) =>
                    setForm({ ...form, education: e.target.value })
                  }
                />
                <Input
                  placeholder="Specialization"
                  onChange={(e) =>
                    setForm({ ...form, specialization: e.target.value })
                  }
                />
                <Input
                  type="number"
                  placeholder="Experience"
                  onChange={(e) =>
                    setForm({ ...form, experience: e.target.value })
                  }
                />
              </>
            )}

            {/* PATIENT FORM */}
            {role === "patient" && (
              <>
                <Input
                  type="number"
                  placeholder="Age"
                  onChange={(e) =>
                    setForm({ ...form, age: e.target.value })
                  }
                />
                <Input
                  placeholder="Disease / Problem"
                  onChange={(e) =>
                    setForm({ ...form, disease: e.target.value })
                  }
                />
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  onChange={(e) =>
                    setForm({ ...form, gender: e.target.value })
                  }
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </>
            )}

            {!role && (
              <p className="text-center text-sm text-muted-foreground">
                Loading...
              </p>
            )}

            {/* BUTTON */}
            <Button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full rounded-xl"
            >
              {loading ? "Saving..." : "Continue"}
            </Button>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}